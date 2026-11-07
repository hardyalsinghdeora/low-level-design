export interface Profile {
  displayName: string;
  bio: string;
  city: string | null;
}

/**
 * A member and their editable profile. Relationships deliberately live in
 * SocialGraph, not on User, so "who is friends with whom" has one owner.
 */
export class User {
  private _profile: Profile;

  constructor(
    readonly id: string,
    readonly handle: string,
    profile: Partial<Profile> = {},
  ) {
    if (!/^[a-z0-9_]{3,20}$/.test(handle)) throw new RangeError(`invalid handle "${handle}"`);
    this._profile = User.validated({ displayName: handle, bio: '', city: null, ...profile });
  }

  get profile(): Readonly<Profile> {
    return this._profile;
  }

  updateProfile(changes: Partial<Profile>): void {
    this._profile = User.validated({ ...this._profile, ...changes });
  }

  private static validated(profile: Profile): Profile {
    if (!profile.displayName.trim()) throw new RangeError('displayName is required');
    if (profile.bio.length > 160) throw new RangeError('bio is limited to 160 characters');
    return profile;
  }
}
