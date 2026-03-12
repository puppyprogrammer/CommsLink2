type VideoMetadata = {
  videoId: string;
  title: string;
  channelTitle?: string;
  thumbnailUrl?: string;
  duration?: string;
};

const YOUTUBE_URL_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/;

/**
 * Extract a YouTube video ID from a URL string.
 */
const getVideoIdFromUrl = (url: string): string | null => {
  const match = url.match(YOUTUBE_URL_REGEX);
  return match ? match[1] : null;
};

/**
 * Convert ISO 8601 duration (PT5M32S) to human-readable (5:32).
 */
const parseDuration = (iso: string): string => {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return iso;
  const h = parseInt(match[1] || '0', 10);
  const m = parseInt(match[2] || '0', 10);
  const s = parseInt(match[3] || '0', 10);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
};

/**
 * Fetch video metadata from YouTube.
 * Uses Data API v3 if YOUTUBE_API_KEY is set, otherwise falls back to oEmbed.
 */
const fetchVideoMetadata = async (videoId: string): Promise<VideoMetadata | null> => {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (apiKey) {
    try {
      const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`YouTube API ${res.status}`);
      const data = (await res.json()) as {
        items?: Array<{
          snippet: { title: string; channelTitle: string; thumbnails: { medium?: { url: string } } };
          contentDetails: { duration: string };
        }>;
      };
      const item = data.items?.[0];
      if (!item) return null;
      return {
        videoId,
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle,
        thumbnailUrl: item.snippet.thumbnails.medium?.url,
        duration: parseDuration(item.contentDetails.duration),
      };
    } catch (err) {
      console.error('[YouTube] API fetch failed, trying oEmbed:', err);
    }
  }

  // Fallback: oEmbed (no API key needed, but no duration/channel)
  try {
    const url = `https://www.youtube.com/oembed?url=https://youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { title: string; author_name?: string; thumbnail_url?: string };
    return {
      videoId,
      title: data.title,
      channelTitle: data.author_name,
      thumbnailUrl: data.thumbnail_url,
    };
  } catch (err) {
    console.error('[YouTube] oEmbed fetch failed:', err);
    return null;
  }
};

export type { VideoMetadata };
export default { getVideoIdFromUrl, fetchVideoMetadata };
