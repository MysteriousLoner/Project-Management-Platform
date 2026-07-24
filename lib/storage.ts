import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  S3Client,
  UploadPartCommand
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";

const globalStorage = globalThis as unknown as {
  s3?: S3Client;
  bucketReady?: Promise<void>;
};

export const bucket = process.env.S3_BUCKET ?? "project-attachments";

export const s3 =
  globalStorage.s3 ??
  new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? "project_manager",
      secretAccessKey: process.env.S3_SECRET_KEY ?? "local-storage-password"
    }
  });

if (process.env.NODE_ENV !== "production") globalStorage.s3 = s3;

export async function ensureBucket() {
  if (!globalStorage.bucketReady) {
    globalStorage.bucketReady = (async () => {
      try {
        await s3.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch {
        await s3.send(new CreateBucketCommand({ Bucket: bucket }));
      }
    })();
  }
  await globalStorage.bucketReady;
}

export async function beginMultipart(objectKey: string, contentType: string) {
  await ensureBucket();
  const result = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: contentType
    })
  );
  if (!result.UploadId) throw new Error("Object storage did not return an upload ID.");
  return result.UploadId;
}

export async function uploadPart(input: {
  objectKey: string;
  uploadId: string;
  partNumber: number;
  body: Readable;
  contentLength: number;
}) {
  return s3.send(
    new UploadPartCommand({
      Bucket: bucket,
      Key: input.objectKey,
      UploadId: input.uploadId,
      PartNumber: input.partNumber,
      Body: input.body,
      ContentLength: input.contentLength
    })
  );
}

export async function completeMultipart(
  objectKey: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[]
) {
  return s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: objectKey,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag }))
      }
    })
  );
}

export async function abortMultipart(objectKey: string, uploadId: string) {
  return s3.send(
    new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: objectKey,
      UploadId: uploadId
    })
  );
}

export async function getObject(objectKey: string, range?: string | null) {
  return s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Range: range ?? undefined
    })
  );
}

export async function deleteObject(objectKey: string) {
  return s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
}
