import { profileDisplayName } from '../profile-presentation';

describe('profile presentation', () => {
  it('prefers the freshest profile name over the cached auth session name', () => {
    expect(profileDisplayName({ profileName: 'Deepak', sessionName: 'User' })).toBe('Deepak');
  });

  it('falls back to the session name and then a neutral default', () => {
    expect(profileDisplayName({ profileName: null, sessionName: 'User' })).toBe('User');
    expect(profileDisplayName({ profileName: '   ', sessionName: '   ' })).toBe('Player');
  });
});
