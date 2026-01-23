"""
FinBERT Sentiment Analysis Module

Uses the ProsusAI/finbert model for financial sentiment analysis.
FinBERT is a BERT model fine-tuned on financial text for sentiment classification.

Model: ProsusAI/finbert (https://huggingface.co/ProsusAI/finbert)
Labels: positive, negative, neutral
"""

import torch
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)

# Lazy load transformers to avoid startup delay if not needed
_tokenizer = None
_model = None
_model_loaded = False
_load_error: Optional[str] = None


@dataclass
class SentimentResult:
    """Result of sentiment analysis"""
    text: str
    sentiment: str  # 'positive', 'negative', 'neutral'
    score: float  # -1 to 1 (negative to positive)
    confidence: float  # 0 to 1
    probabilities: Dict[str, float]  # Raw probabilities for each class


def _load_model() -> Tuple[bool, Optional[str]]:
    """
    Lazy load the FinBERT model and tokenizer.
    Returns (success, error_message)
    """
    global _tokenizer, _model, _model_loaded, _load_error
    
    if _model_loaded:
        return True, None
    
    if _load_error:
        return False, _load_error
    
    try:
        from transformers import AutoTokenizer, AutoModelForSequenceClassification
        
        logger.info("Loading FinBERT model (this may take a moment on first run)...")
        
        model_name = "ProsusAI/finbert"
        
        # Load tokenizer and model
        _tokenizer = AutoTokenizer.from_pretrained(model_name)
        _model = AutoModelForSequenceClassification.from_pretrained(model_name)
        
        # Move to GPU if available
        if torch.cuda.is_available():
            _model = _model.cuda()
            logger.info(f"FinBERT loaded on GPU: {torch.cuda.get_device_name(0)}")
        else:
            logger.info("FinBERT loaded on CPU")
        
        # Set to evaluation mode
        _model.eval()
        
        _model_loaded = True
        return True, None
        
    except ImportError as e:
        _load_error = f"Transformers library not installed: {e}"
        logger.error(_load_error)
        return False, _load_error
    except Exception as e:
        _load_error = f"Failed to load FinBERT model: {e}"
        logger.error(_load_error)
        return False, _load_error


def is_model_available() -> bool:
    """Check if the FinBERT model is loaded and available"""
    return _model_loaded


def get_model_status() -> Dict:
    """Get the status of the FinBERT model"""
    return {
        "loaded": _model_loaded,
        "error": _load_error,
        "device": "cuda" if _model_loaded and next(_model.parameters()).is_cuda else "cpu" if _model_loaded else None,
        "model_name": "ProsusAI/finbert"
    }


def analyze_sentiment(text: str) -> Optional[SentimentResult]:
    """
    Analyze sentiment of a single text using FinBERT.
    
    Args:
        text: The text to analyze (news headline or summary)
        
    Returns:
        SentimentResult with sentiment, score, and confidence
    """
    success, error = _load_model()
    if not success:
        logger.warning(f"FinBERT not available: {error}")
        return None
    
    try:
        # Tokenize
        inputs = _tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            max_length=512,
            padding=True
        )
        
        # Move to same device as model
        if next(_model.parameters()).is_cuda:
            inputs = {k: v.cuda() for k, v in inputs.items()}
        
        # Get predictions
        with torch.no_grad():
            outputs = _model(**inputs)
            logits = outputs.logits
            
            # Apply softmax to get probabilities
            probs = torch.nn.functional.softmax(logits, dim=-1)
            probs = probs.cpu().numpy()[0]
        
        # FinBERT labels: 0=positive, 1=negative, 2=neutral
        labels = ['positive', 'negative', 'neutral']
        probabilities = {label: float(prob) for label, prob in zip(labels, probs)}
        
        # Get predicted sentiment
        predicted_idx = probs.argmax()
        sentiment = labels[predicted_idx]
        confidence = float(probs[predicted_idx])
        
        # Calculate score from -1 (bearish) to 1 (bullish)
        # positive contributes positively, negative contributes negatively
        score = probabilities['positive'] - probabilities['negative']
        
        return SentimentResult(
            text=text[:200],  # Truncate for storage
            sentiment=sentiment,
            score=round(score, 4),
            confidence=round(confidence, 4),
            probabilities=probabilities
        )
        
    except Exception as e:
        logger.error(f"Error analyzing sentiment: {e}")
        return None


def analyze_batch(texts: List[str], batch_size: int = 8) -> List[Optional[SentimentResult]]:
    """
    Analyze sentiment of multiple texts in batches for efficiency.
    
    Args:
        texts: List of texts to analyze
        batch_size: Number of texts to process at once
        
    Returns:
        List of SentimentResult objects (None for failed analyses)
    """
    success, error = _load_model()
    if not success:
        logger.warning(f"FinBERT not available: {error}")
        return [None] * len(texts)
    
    results = []
    
    # Process in batches
    for i in range(0, len(texts), batch_size):
        batch_texts = texts[i:i + batch_size]
        
        try:
            # Tokenize batch
            inputs = _tokenizer(
                batch_texts,
                return_tensors="pt",
                truncation=True,
                max_length=512,
                padding=True
            )
            
            # Move to same device as model
            if next(_model.parameters()).is_cuda:
                inputs = {k: v.cuda() for k, v in inputs.items()}
            
            # Get predictions
            with torch.no_grad():
                outputs = _model(**inputs)
                logits = outputs.logits
                probs = torch.nn.functional.softmax(logits, dim=-1)
                probs = probs.cpu().numpy()
            
            # Process each result
            labels = ['positive', 'negative', 'neutral']
            for j, text in enumerate(batch_texts):
                text_probs = probs[j]
                probabilities = {label: float(prob) for label, prob in zip(labels, text_probs)}
                
                predicted_idx = text_probs.argmax()
                sentiment = labels[predicted_idx]
                confidence = float(text_probs[predicted_idx])
                score = probabilities['positive'] - probabilities['negative']
                
                results.append(SentimentResult(
                    text=text[:200],
                    sentiment=sentiment,
                    score=round(score, 4),
                    confidence=round(confidence, 4),
                    probabilities=probabilities
                ))
                
        except Exception as e:
            logger.error(f"Error analyzing batch: {e}")
            # Add None for each failed item in batch
            results.extend([None] * len(batch_texts))
    
    return results


def preload_model() -> bool:
    """
    Preload the model (useful for startup).
    Returns True if successful.
    """
    success, _ = _load_model()
    return success
