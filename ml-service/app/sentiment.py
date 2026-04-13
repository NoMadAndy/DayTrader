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


_FINBERT_LABELS = ['positive', 'negative', 'neutral']
_FINBERT_MAX_TOKENS = 512  # CLS + 510 content + SEP
_FINBERT_CHUNK_STRIDE = 64  # overlap to keep cross-sentence context


def _result_from_probs(text: str, probs) -> SentimentResult:
    """Build a SentimentResult from a (3,) probability vector."""
    probabilities = {label: float(p) for label, p in zip(_FINBERT_LABELS, probs)}
    predicted_idx = int(probs.argmax())
    score = probabilities['positive'] - probabilities['negative']
    return SentimentResult(
        text=text[:200],
        sentiment=_FINBERT_LABELS[predicted_idx],
        score=round(score, 4),
        confidence=round(float(probs[predicted_idx]), 4),
        probabilities=probabilities,
    )


def _predict_chunked(text: str):
    """
    Tokenize `text` with overlapping 512-token windows and return a single (3,)
    probability vector aggregated across all chunks via confidence weighting
    (max-prob per chunk). For text that fits in 512 tokens this collapses to
    the same single forward pass as before.
    """
    inputs = _tokenizer(
        text,
        return_tensors="pt",
        truncation=True,
        max_length=_FINBERT_MAX_TOKENS,
        stride=_FINBERT_CHUNK_STRIDE,
        return_overflowing_tokens=True,
        padding=True,
    )
    # Strip non-model fields produced by return_overflowing_tokens
    model_inputs = {k: v for k, v in inputs.items()
                    if k in ('input_ids', 'attention_mask', 'token_type_ids')}
    if next(_model.parameters()).is_cuda:
        model_inputs = {k: v.cuda() for k, v in model_inputs.items()}

    with torch.no_grad():
        logits = _model(**model_inputs).logits
        chunk_probs = torch.nn.functional.softmax(logits, dim=-1).cpu().numpy()
    # (n_chunks, 3) → confidence-weighted mean
    if chunk_probs.shape[0] == 1:
        return chunk_probs[0]
    confidences = chunk_probs.max(axis=1)
    if confidences.sum() == 0:
        return chunk_probs.mean(axis=0)
    return (chunk_probs * confidences[:, None]).sum(axis=0) / confidences.sum()


def analyze_sentiment(text: str) -> Optional[SentimentResult]:
    """
    Analyze sentiment of a single text using FinBERT. Texts longer than 512
    tokens are split into overlapping windows and aggregated (confidence-
    weighted mean) instead of being silently truncated.
    """
    success, error = _load_model()
    if not success:
        logger.warning(f"FinBERT not available: {error}")
        return None

    try:
        agg_probs = _predict_chunked(text)
        return _result_from_probs(text, agg_probs)
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
    
    # Pre-classify each text by token length. Short texts use the fast batched
    # path; long ones go through _predict_chunked individually so chunks stay
    # contiguous to their source text.
    lengths = [len(_tokenizer.encode(t, add_special_tokens=True, truncation=False))
               for t in texts]

    results: List[Optional[SentimentResult]] = [None] * len(texts)
    short_indices = [i for i, n in enumerate(lengths) if n <= _FINBERT_MAX_TOKENS]
    long_indices = [i for i, n in enumerate(lengths) if n > _FINBERT_MAX_TOKENS]

    # Fast batched path for texts that fit
    for i in range(0, len(short_indices), batch_size):
        idx_slice = short_indices[i:i + batch_size]
        batch_texts = [texts[j] for j in idx_slice]
        try:
            inputs = _tokenizer(
                batch_texts,
                return_tensors="pt",
                truncation=True,
                max_length=_FINBERT_MAX_TOKENS,
                padding=True,
            )
            if next(_model.parameters()).is_cuda:
                inputs = {k: v.cuda() for k, v in inputs.items()}
            with torch.no_grad():
                logits = _model(**inputs).logits
                probs = torch.nn.functional.softmax(logits, dim=-1).cpu().numpy()
            for k, text_idx in enumerate(idx_slice):
                results[text_idx] = _result_from_probs(texts[text_idx], probs[k])
        except Exception as e:
            logger.error(f"Error analyzing batch: {e}")
            # leave as None for failed slots

    # Per-text chunked path for long texts (rare on headlines, common on bodies)
    for text_idx in long_indices:
        try:
            agg_probs = _predict_chunked(texts[text_idx])
            results[text_idx] = _result_from_probs(texts[text_idx], agg_probs)
        except Exception as e:
            logger.error(f"Error analyzing chunked text: {e}")

    return results


def preload_model() -> bool:
    """
    Preload the model (useful for startup).
    Returns True if successful.
    """
    success, _ = _load_model()
    return success
