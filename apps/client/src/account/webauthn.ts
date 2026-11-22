// WebAuthn JSON <-> browser credential objects. The gateway (webauthn-rs) speaks base64url strings; the
// browser API wants ArrayBuffers. Written by hand so it works in browsers without the newer
// PublicKeyCredential.parseCreationOptionsFromJSON helpers.

export function b64urlToBytes(s: string): ArrayBuffer {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function bytesToB64url(buf: ArrayBuffer | ArrayBufferView): string {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type Json = Record<string, unknown>;
const descriptors = (list: unknown) => (Array.isArray(list) ? list.map((c: Json) => ({ ...c, id: b64urlToBytes(c.id as string) })) : undefined);

/** `{publicKey: {...}}` creation options from the gateway -> CredentialCreationOptions. */
export function creationOptions(options: Json): CredentialCreationOptions {
  const pk = options.publicKey as Json;
  const user = pk.user as Json;
  return {
    publicKey: {
      ...(pk as unknown as PublicKeyCredentialCreationOptions),
      challenge: b64urlToBytes(pk.challenge as string),
      user: { ...(user as unknown as PublicKeyCredentialUserEntity), id: b64urlToBytes(user.id as string) },
      excludeCredentials: descriptors(pk.excludeCredentials) as PublicKeyCredentialDescriptor[] | undefined,
    },
  };
}

/** `{publicKey: {...}}` request options from the gateway -> CredentialRequestOptions. */
export function requestOptions(options: Json): CredentialRequestOptions {
  const pk = options.publicKey as Json;
  return {
    publicKey: {
      ...(pk as unknown as PublicKeyCredentialRequestOptions),
      challenge: b64urlToBytes(pk.challenge as string),
      allowCredentials: descriptors(pk.allowCredentials) as PublicKeyCredentialDescriptor[] | undefined,
    },
  };
}

/** A new credential in the shape webauthn-rs' RegisterPublicKeyCredential expects. */
export function registrationJSON(cred: PublicKeyCredential): Json {
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: bytesToB64url(cred.rawId),
    type: cred.type,
    response: {
      attestationObject: bytesToB64url(r.attestationObject),
      clientDataJSON: bytesToB64url(r.clientDataJSON),
      transports: typeof r.getTransports === 'function' ? r.getTransports() : undefined,
    },
    extensions: cred.getClientExtensionResults(),
  };
}

/** An assertion in the shape webauthn-rs' PublicKeyCredential expects. */
export function assertionJSON(cred: PublicKeyCredential): Json {
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: bytesToB64url(cred.rawId),
    type: cred.type,
    response: {
      authenticatorData: bytesToB64url(r.authenticatorData),
      clientDataJSON: bytesToB64url(r.clientDataJSON),
      signature: bytesToB64url(r.signature),
      userHandle: r.userHandle ? bytesToB64url(r.userHandle) : null,
    },
    extensions: cred.getClientExtensionResults(),
  };
}

export const passkeysSupported = (): boolean => typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && !!navigator.credentials;
