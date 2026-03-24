import { AwsClient } from "aws4fetch";
import type { Env, FileEntry } from "../types";

let cachedClient: AwsClient | null = null;

function getR2Client(env: Env): AwsClient {
  if (!cachedClient) {
    cachedClient = new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      service: "s3",
      region: "auto",
    });
  }
  return cachedClient;
}

export async function generatePresignedPutUrl(
  env: Env,
  key: string,
  contentType: string,
  expiresInSeconds = 600,
): Promise<string> {
  const client = getR2Client(env);
  const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const url = `${endpoint}/easl-content/${key}?X-Amz-Expires=${expiresInSeconds}`;

  const signed = await client.sign(
    new Request(url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
    }),
    { aws: { signQuery: true } },
  );

  return signed.url;
}

export async function generateUploadUrls(
  env: Env,
  slug: string,
  versionId: string,
  files: FileEntry[],
): Promise<Array<{ path: string; method: "PUT"; url: string; headers: Record<string, string> }>> {
  return Promise.all(
    files.map(async (file) => {
      const r2Key = `${slug}/${versionId}/${file.path}`;
      const url = await generatePresignedPutUrl(env, r2Key, file.contentType);
      return {
        path: file.path,
        method: "PUT" as const,
        url,
        headers: { "Content-Type": file.contentType },
      };
    }),
  );
}
