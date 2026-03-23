import { ComprehendClient, DetectSentimentCommand } from '@aws-sdk/client-comprehend';

type SentimentResult = {
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';
  scores: {
    positive: number;
    negative: number;
    neutral: number;
    mixed: number;
  };
};

const getClient = (): ComprehendClient =>
  new ComprehendClient({ region: process.env.AWS_REGION || 'us-east-2' });

/**
 * Detect sentiment of the given text using Amazon Comprehend.
 * Returns the dominant sentiment label and confidence scores.
 */
const detectSentiment = async (
  text: string,
  languageCode?: string,
): Promise<SentimentResult> => {
  const client = getClient();

  const command = new DetectSentimentCommand({
    Text: text,
    LanguageCode: languageCode || 'en',
  });

  const response = await client.send(command);

  return {
    sentiment: (response.Sentiment as SentimentResult['sentiment']) || 'NEUTRAL',
    scores: {
      positive: response.SentimentScore?.Positive || 0,
      negative: response.SentimentScore?.Negative || 0,
      neutral: response.SentimentScore?.Neutral || 0,
      mixed: response.SentimentScore?.Mixed || 0,
    },
  };
};

export type { SentimentResult };
export default { detectSentiment };
