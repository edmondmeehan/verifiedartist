// Server-only Spotify Web API helpers (Client Credentials flow).

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAppToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Spotify credentials not configured");
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Spotify auth failed: ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function sp<T>(path: string): Promise<T> {
  const token = await getAppToken();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export type SpotifySearchResult = {
  id: string;
  name: string;
  image: string | null;
  genres: string[];
  followers: number;
  popularity: number;
  spotify_url: string;
};

type SpotifyArtist = {
  id: string;
  name: string;
  genres: string[];
  popularity: number;
  followers: { total: number };
  images: { url: string; width: number; height: number }[];
  external_urls: { spotify: string };
};

type SpotifyAlbumsResponse = {
  items: Array<{
    id: string;
    name: string;
    release_date: string;
    album_type: string;
    external_urls: { spotify: string };
    images: { url: string }[];
  }>;
};

export async function searchArtists(query: string, limit = 8): Promise<SpotifySearchResult[]> {
  if (!query.trim()) return [];
  const data = await sp<{ artists: { items: SpotifyArtist[] } }>(
    `/search?type=artist&limit=${limit}&q=${encodeURIComponent(query)}`,
  );
  return data.artists.items.map((a) => ({
    id: a.id,
    name: a.name,
    image: a.images[0]?.url ?? null,
    genres: a.genres,
    followers: a.followers.total,
    popularity: a.popularity,
    spotify_url: a.external_urls.spotify,
  }));
}

export type SpotifyEnrichment = {
  spotify_id: string;
  name: string;
  genres: string[];
  followers: number;
  popularity: number;
  image: string | null;
  spotify_url: string;
  latest_release: { title: string; date: string; url: string; image: string | null } | null;
};

export async function getArtistEnrichment(spotifyId: string): Promise<SpotifyEnrichment> {
  const artist = await sp<SpotifyArtist>(`/artists/${spotifyId}`);
  let latest: SpotifyEnrichment["latest_release"] = null;
  try {
    const albums = await sp<SpotifyAlbumsResponse>(
      `/artists/${spotifyId}/albums?include_groups=album,single&market=US&limit=50`,
    );
    const sorted = [...albums.items].sort((a, b) => (a.release_date < b.release_date ? 1 : -1));
    const top = sorted[0];
    if (top) {
      latest = {
        title: top.name,
        date: top.release_date,
        url: top.external_urls.spotify,
        image: top.images[0]?.url ?? null,
      };
    }
  } catch {
    // non-fatal
  }
  return {
    spotify_id: artist.id,
    name: artist.name,
    genres: artist.genres,
    followers: artist.followers.total,
    popularity: artist.popularity,
    image: artist.images[0]?.url ?? null,
    spotify_url: artist.external_urls.spotify,
    latest_release: latest,
  };
}
