import Data from '../../data';
import youtubeAdapter from '../../adapters/youtube';
import creditActions from '../credit';
import grokAdapter from '../../adapters/grok';

/**
 * Add a YouTube video to the user's watchlist.
 */
const addToWatchlist = async (userId: string, url: string): Promise<string> => {
  const videoId = youtubeAdapter.getVideoIdFromUrl(url);
  if (!videoId) return 'Invalid YouTube URL. Use a youtube.com/watch?v= or youtu.be/ link.';

  const existing = await Data.watchlistItem.findByUserAndVideo(userId, videoId);
  if (existing) return `"${existing.title}" is already on your watchlist.`;

  const metadata = await youtubeAdapter.fetchVideoMetadata(videoId);
  if (!metadata) return 'Could not fetch video info. Check the URL and try again.';

  await Data.watchlistItem.create({
    user_id: userId,
    video_id: metadata.videoId,
    title: metadata.title,
    channel: metadata.channelTitle,
    thumbnail: metadata.thumbnailUrl,
    duration: metadata.duration,
  });

  return `Added "${metadata.title}"${metadata.duration ? ` (${metadata.duration})` : ''} to your watchlist.`;
};

/**
 * List the user's watchlist, optionally filtered by status.
 */
const listWatchlist = async (userId: string, statusFilter?: string): Promise<string> => {
  const status = statusFilter?.toUpperCase() === 'WATCHED' ? 'WATCHED' as const
    : statusFilter?.toUpperCase() === 'UNWATCHED' ? 'UNWATCHED' as const
    : undefined;

  const items = await Data.watchlistItem.findByUser(userId, status);
  if (items.length === 0) {
    return status
      ? `No ${status.toLowerCase()} videos in your watchlist.`
      : 'Your watchlist is empty. Use `/watchlist add <URL>` to add videos.';
  }

  const lines = items.map((item, i) => {
    const statusIcon = item.status === 'WATCHED' ? '✅' : '⬜';
    const dur = item.duration ? ` (${item.duration})` : '';
    const ch = item.channel ? ` — ${item.channel}` : '';
    return `${statusIcon} ${i + 1}. **${item.title}**${dur}${ch}\n   ID: \`${item.video_id}\``;
  });

  const header = status
    ? `**Your Watchlist** (${status.toLowerCase()}) — ${items.length} video(s):`
    : `**Your Watchlist** — ${items.length} video(s):`;

  return `${header}\n\n${lines.join('\n')}`;
};

/**
 * Remove a video from the user's watchlist by video ID.
 */
const removeFromWatchlist = async (userId: string, videoId: string): Promise<string> => {
  const existing = await Data.watchlistItem.findByUserAndVideo(userId, videoId);
  if (!existing) return `Video \`${videoId}\` not found in your watchlist.`;

  await Data.watchlistItem.remove(userId, videoId);
  return `Removed "${existing.title}" from your watchlist.`;
};

/**
 * Mark a video as watched.
 */
const markWatched = async (userId: string, videoId: string): Promise<string> => {
  const existing = await Data.watchlistItem.findByUserAndVideo(userId, videoId);
  if (!existing) return `Video \`${videoId}\` not found in your watchlist.`;

  await Data.watchlistItem.updateStatus(userId, videoId, 'WATCHED');
  return `Marked "${existing.title}" as watched.`;
};

/**
 * Mark a video as unwatched.
 */
const markUnwatched = async (userId: string, videoId: string): Promise<string> => {
  const existing = await Data.watchlistItem.findByUserAndVideo(userId, videoId);
  if (!existing) return `Video \`${videoId}\` not found in your watchlist.`;

  await Data.watchlistItem.updateStatus(userId, videoId, 'UNWATCHED');
  return `Marked "${existing.title}" as unwatched.`;
};

/**
 * Premium: Summarize a video using Grok AI.
 * Charges credits for the Grok API call.
 */
const summarizeVideo = async (userId: string, videoId: string): Promise<string> => {
  const hasCredits = await creditActions.hasCredits(userId, 5);
  if (!hasCredits) return 'Insufficient credits. Top up to use premium commands.';

  const existing = await Data.watchlistItem.findByUserAndVideo(userId, videoId);
  const title = existing?.title || videoId;

  const prompt = `Provide a concise summary (3-5 bullet points) of the YouTube video titled "${title}" (video ID: ${videoId}). Include the main topics covered, key takeaways, and who would find it useful. If you cannot access the video directly, provide a summary based on your knowledge of the title and channel.`;

  const response = await grokAdapter.chatCompletion(
    'You are a helpful video summarizer. Be concise and informative.',
    [{ role: 'user', content: prompt }],
    undefined,
    1000,
  );

  await creditActions.chargeGrokUsage(userId, response.model, response.inputTokens, response.outputTokens);

  return `**Summary: ${title}**\n\n${response.text}`;
};

/**
 * Premium: Get AI recommendations based on watchlist.
 * Charges credits for the Grok API call.
 */
const recommendVideos = async (userId: string): Promise<string> => {
  const hasCredits = await creditActions.hasCredits(userId, 5);
  if (!hasCredits) return 'Insufficient credits. Top up to use premium commands.';

  const items = await Data.watchlistItem.findByUser(userId);
  if (items.length === 0) return 'Add some videos to your watchlist first so I can make recommendations.';

  const titles = items.map((i) => `- ${i.title}${i.channel ? ` (${i.channel})` : ''}`).join('\n');

  const prompt = `Based on this YouTube watchlist, recommend 5 videos or channels the user might enjoy. Explain briefly why each is a good fit.\n\nWatchlist:\n${titles}`;

  const response = await grokAdapter.chatCompletion(
    'You are a helpful video recommendation engine. Be specific and actionable.',
    [{ role: 'user', content: prompt }],
    undefined,
    1500,
  );

  await creditActions.chargeGrokUsage(userId, response.model, response.inputTokens, response.outputTokens);

  return `**Recommended for You**\n\n${response.text}`;
};

export default {
  addToWatchlist,
  listWatchlist,
  removeFromWatchlist,
  markWatched,
  markUnwatched,
  summarizeVideo,
  recommendVideos,
};
