/**
 * Financial News Sentiment Analysis
 * 
 * Keyword-based sentiment analysis optimized for financial news.
 * Uses domain-specific word lists for accurate stock market sentiment detection.
 * 
 * Methodology: Combines word frequency analysis with intensity modifiers
 * and negation handling for financial context.
 */

export type SentimentType = 'positive' | 'negative' | 'neutral';

export interface SentimentResult {
  sentiment: SentimentType;
  score: number; // -1 to 1 (negative to positive)
  confidence: number; // 0 to 1
  keywords: {
    positive: string[];
    negative: string[];
  };
}

// Financial-specific positive keywords (weighted by importance)
const POSITIVE_KEYWORDS: Record<string, number> = {
  // Strong positive (weight 2-3)
  'surge': 3, 'soar': 3, 'skyrocket': 3, 'breakthrough': 3, 'record high': 3,
  'outperform': 2.5, 'beat expectations': 3, 'exceeds': 2.5, 'bullish': 2.5,
  'rally': 2.5, 'boom': 2.5, 'strong buy': 3, 'upgrade': 2.5, 'upgraded': 2.5,
  
  // Moderate positive (weight 1.5-2)
  'growth': 2, 'profit': 2, 'gains': 2, 'positive': 1.5, 'rise': 1.5, 'rises': 1.5,
  'rising': 1.5, 'grew': 2, 'increase': 1.5, 'increased': 1.5, 'beat': 2,
  'up': 1, 'higher': 1.5, 'recover': 2, 'recovery': 2, 'rebound': 2,
  'improve': 1.5, 'improved': 1.5, 'improvement': 1.5, 'optimistic': 2,
  'opportunity': 1.5, 'opportunities': 1.5, 'success': 2, 'successful': 2,
  'expand': 1.5, 'expansion': 1.5, 'win': 2, 'winning': 2, 'winner': 2,
  
  // Mild positive (weight 1)
  'buy': 1, 'hold': 0.5, 'stable': 1, 'steady': 1, 'support': 1,
  'innovation': 1.5, 'innovative': 1.5, 'launch': 1, 'launches': 1,
  'partnership': 1, 'deal': 1, 'agreement': 1, 'approval': 1.5, 'approved': 1.5,
  'dividend': 1, 'acquisition': 1, 'acquired': 1, 'milestone': 1.5,
  'demand': 1, 'momentum': 1.5, 'outpace': 1.5, 'accelerate': 1.5,
};

// Financial-specific negative keywords (weighted by importance)
const NEGATIVE_KEYWORDS: Record<string, number> = {
  // Strong negative (weight 2-3)
  'crash': 3, 'plunge': 3, 'collapse': 3, 'bankruptcy': 3, 'bankrupt': 3,
  'fraud': 3, 'scandal': 3, 'crisis': 2.5, 'downgrade': 2.5, 'downgraded': 2.5,
  'bearish': 2.5, 'sell-off': 3, 'selloff': 3, 'tank': 2.5, 'tanks': 2.5,
  'plummet': 3, 'tumble': 2.5, 'slump': 2.5, 'recession': 2.5,
  
  // Moderate negative (weight 1.5-2)
  'loss': 2, 'losses': 2, 'decline': 2, 'declining': 2, 'drop': 2, 'drops': 2,
  'fall': 2, 'falls': 2, 'falling': 2, 'fell': 2, 'down': 1.5, 'lower': 1.5,
  'miss': 2, 'missed': 2, 'misses': 2, 'weak': 2, 'weakness': 2,
  'concern': 1.5, 'concerns': 1.5, 'worried': 1.5, 'worry': 1.5, 'worries': 1.5,
  'risk': 1.5, 'risks': 1.5, 'risky': 1.5, 'volatile': 1.5, 'volatility': 1.5,
  'disappointing': 2, 'disappointed': 2, 'disappoints': 2, 'below expectations': 2,
  
  // Mild negative (weight 1)
  'sell': 1, 'cut': 1, 'cuts': 1, 'layoffs': 1.5, 'layoff': 1.5, 'restructuring': 1,
  'uncertainty': 1.5, 'uncertain': 1.5, 'pressure': 1, 'pressures': 1,
  'challenge': 1, 'challenges': 1, 'struggle': 1.5, 'struggles': 1.5,
  'debt': 1, 'deficit': 1.5, 'lawsuit': 1.5, 'investigation': 1.5,
  'delay': 1, 'delayed': 1, 'warning': 1.5, 'warns': 1.5, 'caution': 1,
  'slow': 1, 'slower': 1, 'slowdown': 1.5, 'shrink': 1.5, 'shrinking': 1.5,
};

// Negation words that flip sentiment
const NEGATION_WORDS = new Set([
  'not', 'no', 'never', 'neither', 'nobody', 'nothing', 'nowhere',
  'without', 'hardly', 'barely', 'scarcely', "n't", "don't", "doesn't",
  "didn't", "won't", "wouldn't", "couldn't", "shouldn't", "isn't", "aren't"
]);

// Intensifiers that strengthen sentiment
const INTENSIFIERS: Record<string, number> = {
  'very': 1.5, 'extremely': 2, 'highly': 1.5, 'significantly': 1.5,
  'substantially': 1.5, 'considerably': 1.3, 'dramatically': 1.8,
  'sharply': 1.5, 'strongly': 1.5, 'massive': 1.8, 'major': 1.3,
  'huge': 1.5, 'big': 1.2, 'large': 1.2, 'tremendous': 1.8,
};

// Diminishers that weaken sentiment
const DIMINISHERS: Record<string, number> = {
  'slightly': 0.5, 'somewhat': 0.6, 'marginally': 0.5, 'barely': 0.4,
  'hardly': 0.4, 'little': 0.5, 'minor': 0.6, 'modest': 0.7,
  'moderate': 0.7, 'modestly': 0.7, 'small': 0.6,
};

/**
 * Analyze sentiment of a financial news text
 */
export function analyzeSentiment(text: string): SentimentResult {
  const lowerText = text.toLowerCase();
  const words = lowerText.split(/\s+/);
  
  let positiveScore = 0;
  let negativeScore = 0;
  const foundPositive: string[] = [];
  const foundNegative: string[] = [];
  
  // Check for phrase matches first (higher priority)
  for (const [phrase, weight] of Object.entries(POSITIVE_KEYWORDS)) {
    if (phrase.includes(' ') && lowerText.includes(phrase)) {
      positiveScore += weight;
      foundPositive.push(phrase);
    }
  }
  for (const [phrase, weight] of Object.entries(NEGATIVE_KEYWORDS)) {
    if (phrase.includes(' ') && lowerText.includes(phrase)) {
      negativeScore += weight;
      foundNegative.push(phrase);
    }
  }
  
  // Process individual words with context
  for (let i = 0; i < words.length; i++) {
    const word = words[i].replace(/[^a-z']/g, '');
    if (!word) continue;
    
    // Check for negation in previous 3 words
    const hasNegation = words.slice(Math.max(0, i - 3), i)
      .some(w => NEGATION_WORDS.has(w.replace(/[^a-z']/g, '')));
    
    // Check for intensifiers/diminishers
    let modifier = 1;
    for (let j = Math.max(0, i - 2); j < i; j++) {
      const prevWord = words[j].replace(/[^a-z]/g, '');
      if (INTENSIFIERS[prevWord]) {
        modifier = INTENSIFIERS[prevWord];
      } else if (DIMINISHERS[prevWord]) {
        modifier = DIMINISHERS[prevWord];
      }
    }
    
    // Score word
    if (POSITIVE_KEYWORDS[word]) {
      const score = POSITIVE_KEYWORDS[word] * modifier;
      if (hasNegation) {
        negativeScore += score * 0.8; // Negated positive becomes weaker negative
        foundNegative.push(`not ${word}`);
      } else {
        positiveScore += score;
        if (!foundPositive.includes(word)) foundPositive.push(word);
      }
    }
    
    if (NEGATIVE_KEYWORDS[word]) {
      const score = NEGATIVE_KEYWORDS[word] * modifier;
      if (hasNegation) {
        positiveScore += score * 0.8; // Negated negative becomes weaker positive
        foundPositive.push(`not ${word}`);
      } else {
        negativeScore += score;
        if (!foundNegative.includes(word)) foundNegative.push(word);
      }
    }
  }
  
  // Calculate final score (-1 to 1)
  const totalMagnitude = positiveScore + negativeScore;
  const rawScore = totalMagnitude > 0 
    ? (positiveScore - negativeScore) / totalMagnitude 
    : 0;
  
  // Calculate confidence based on keyword density and total matches
  const wordCount = words.length;
  const keywordCount = foundPositive.length + foundNegative.length;
  const keywordDensity = keywordCount / Math.max(wordCount, 1);
  const confidence = Math.min(1, keywordDensity * 5 + totalMagnitude / 10);
  
  // Determine sentiment category
  let sentiment: SentimentType;
  if (rawScore > 0.15) {
    sentiment = 'positive';
  } else if (rawScore < -0.15) {
    sentiment = 'negative';
  } else {
    sentiment = 'neutral';
  }
  
  return {
    sentiment,
    score: Math.round(rawScore * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    keywords: {
      positive: foundPositive.slice(0, 5), // Top 5
      negative: foundNegative.slice(0, 5),
    },
  };
}

/**
 * Get sentiment label with emoji for display
 */
export function getSentimentLabel(sentiment: SentimentType): { label: string; emoji: string; color: string } {
  switch (sentiment) {
    case 'positive':
      return { label: 'Bullish', emoji: '📈', color: 'green' };
    case 'negative':
      return { label: 'Bearish', emoji: '📉', color: 'red' };
    case 'neutral':
      return { label: 'Neutral', emoji: '➖', color: 'gray' };
  }
}

/**
 * Batch analyze multiple news items
 */
export function analyzeNewsItems(items: Array<{ headline: string; summary?: string }>): SentimentResult[] {
  return items.map(item => {
    const text = `${item.headline} ${item.summary || ''}`;
    return analyzeSentiment(text);
  });
}
