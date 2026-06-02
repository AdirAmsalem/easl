import { describe, it, expect } from 'vitest';
import { classifyDeviceTokenResponse } from './login';

// The `easl login --device` poll loop must keep polling through transient
// conditions and abort only on a definitive terminal response. This pins down the
// classifier — in particular the regression where a 429 mid-poll killed the login.
describe('classifyDeviceTokenResponse', () => {
  it('returns the token on a 2xx carrying access_token', () => {
    expect(classifyDeviceTokenResponse(200, { access_token: 'sess_abc' })).toEqual({
      kind: 'token',
      token: 'sess_abc',
    });
  });

  it('keeps polling (pending) on authorization_pending — the common case', () => {
    expect(classifyDeviceTokenResponse(400, { error: 'authorization_pending' })).toEqual({
      kind: 'pending',
    });
  });

  it('backs off — NOT fatal — on a 429 rate limit (regression guard)', () => {
    expect(classifyDeviceTokenResponse(429, {})).toEqual({ kind: 'backoff' });
  });

  it('backs off on 5xx server errors', () => {
    expect(classifyDeviceTokenResponse(503, {})).toEqual({ kind: 'backoff' });
    expect(classifyDeviceTokenResponse(500, { error: 'whatever' })).toEqual({ kind: 'backoff' });
  });

  it('backs off on slow_down', () => {
    expect(classifyDeviceTokenResponse(400, { error: 'slow_down' })).toEqual({ kind: 'backoff' });
  });

  it('is terminal (expired) on expired_token and invalid_grant', () => {
    expect(classifyDeviceTokenResponse(400, { error: 'expired_token' })).toEqual({ kind: 'expired' });
    expect(classifyDeviceTokenResponse(400, { error: 'invalid_grant' })).toEqual({ kind: 'expired' });
  });

  it('is terminal (denied) on access_denied', () => {
    expect(classifyDeviceTokenResponse(403, { error: 'access_denied' })).toEqual({ kind: 'denied' });
  });

  it('keeps polling on an unrecognized error rather than aborting', () => {
    expect(classifyDeviceTokenResponse(400, { error: 'something_unexpected' })).toEqual({
      kind: 'pending',
    });
    // A 200 with no access_token is also not terminal — keep waiting.
    expect(classifyDeviceTokenResponse(200, {})).toEqual({ kind: 'pending' });
  });
});
