import {
  BlobNotFoundError,
  del,
  get,
  head,
  put,
  type GetBlobResult,
  type HeadBlobResult,
  type PutBlobResult,
} from "@vercel/blob";

import type {
  VercelPrivateBlobClientV1,
  VercelPrivateBlobPutOptionsV1,
} from "./vercel-blob";

export interface OfficialVercelBlobBindingsV1 {
  put(
    pathname: string,
    bytes: Uint8Array,
    options: VercelPrivateBlobPutOptionsV1,
  ): Promise<Pick<PutBlobResult, "pathname" | "url">>;
  head(pathname: string, options: Readonly<{ token: string }>): Promise<HeadBlobResult>;
  get(
    pathname: string,
    options: Readonly<{
      access: "private";
      token: string;
      useCache: false;
    }>,
  ): Promise<GetBlobResult | null>;
  del(pathname: string, options: Readonly<{ token: string }>): Promise<void>;
  isNotFound(error: unknown): boolean;
}

const OFFICIAL_BINDINGS: OfficialVercelBlobBindingsV1 = {
  put(pathname, bytes, options) {
    return put(pathname, Buffer.from(bytes), options);
  },
  head,
  get,
  del,
  isNotFound(error: unknown): boolean {
    return error instanceof BlobNotFoundError;
  },
};

/**
 * Exact adapter for the reviewed server-side @vercel/blob SDK. Credentials are
 * passed explicitly on every call and never inherited by the scientific child.
 * Reads bypass CDN cache so exact-byte readback/deletion probes reach origin.
 */
export class OfficialVercelPrivateBlobClient
  implements VercelPrivateBlobClientV1
{
  readonly #bindings: OfficialVercelBlobBindingsV1;

  constructor(bindings: OfficialVercelBlobBindingsV1 = OFFICIAL_BINDINGS) {
    this.#bindings = bindings;
  }

  put(
    pathname: string,
    bytes: Uint8Array,
    options: VercelPrivateBlobPutOptionsV1,
  ): Promise<Readonly<{ pathname: string; url: string }>> {
    return this.#bindings.put(pathname, bytes, options);
  }

  async head(
    pathname: string,
    token: string,
  ): Promise<Readonly<{ pathname: string; size: number }> | null> {
    try {
      const result = await this.#bindings.head(pathname, { token });
      return Object.freeze({ pathname: result.pathname, size: result.size });
    } catch (error) {
      if (this.#bindings.isNotFound(error)) return null;
      throw error;
    }
  }

  async download(pathname: string, token: string): Promise<Uint8Array | null> {
    const result = await this.#bindings.get(pathname, {
      access: "private",
      token,
      useCache: false,
    });
    if (result === null) return null;
    if (result.statusCode !== 200 || result.stream === null) {
      throw new TypeError("Private Blob returned a non-byte response.");
    }
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  }

  del(pathname: string, token: string): Promise<void> {
    return this.#bindings.del(pathname, { token });
  }
}
