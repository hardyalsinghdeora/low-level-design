import { NotFoundError } from './errors';

export enum Genre {
  POP = 'POP',
  ROCK = 'ROCK',
  JAZZ = 'JAZZ',
  HIP_HOP = 'HIP_HOP',
  CLASSICAL = 'CLASSICAL',
}

export interface Artist {
  id: string;
  name: string;
}

export interface Album {
  id: string;
  title: string;
  artistId: string;
  releaseYear: number;
  songIds: string[];
}

export interface Song {
  id: string;
  title: string;
  artistId: string;
  albumId: string;
  genre: Genre;
  durationSec: number;
}

/**
 * The read-mostly catalogue. Songs take their artist from the album, so a
 * song can never point at an artist its album does not belong to.
 */
export class Catalog {
  private readonly artists = new Map<string, Artist>();
  private readonly albums = new Map<string, Album>();
  private readonly songs = new Map<string, Song>();

  addArtist(id: string, name: string): Artist {
    const artist = { id, name };
    this.artists.set(id, artist);
    return artist;
  }

  addAlbum(id: string, title: string, artistId: string, releaseYear: number): Album {
    this.artist(artistId);
    const album: Album = { id, title, artistId, releaseYear, songIds: [] };
    this.albums.set(id, album);
    return album;
  }

  addSong(id: string, title: string, albumId: string, genre: Genre, durationSec: number): Song {
    if (!Number.isInteger(durationSec) || durationSec <= 0) {
      throw new RangeError(`duration must be a positive number of seconds, got ${durationSec}`);
    }
    const album = this.album(albumId);
    const song: Song = { id, title, artistId: album.artistId, albumId, genre, durationSec };
    this.songs.set(id, song);
    album.songIds.push(id);
    return song;
  }

  artist(id: string): Artist {
    const artist = this.artists.get(id);
    if (!artist) throw new NotFoundError('artist', id);
    return artist;
  }

  album(id: string): Album {
    const album = this.albums.get(id);
    if (!album) throw new NotFoundError('album', id);
    return album;
  }

  song(id: string): Song {
    const song = this.songs.get(id);
    if (!song) throw new NotFoundError('song', id);
    return song;
  }

  albumSongs(albumId: string): Song[] {
    return this.album(albumId).songIds.map((id) => this.song(id));
  }

  allSongs(): Song[] {
    return [...this.songs.values()];
  }
}
