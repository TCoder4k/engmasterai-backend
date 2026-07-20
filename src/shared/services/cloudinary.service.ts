import { Injectable, Inject } from '@nestjs/common';
import { UploadApiErrorResponse, UploadApiResponse, v2 } from 'cloudinary';
const toStream = require('buffer-to-stream');

@Injectable()
export class CloudinaryService {
  constructor(@Inject('CLOUDINARY') private cloudinary: typeof v2) {}

  async uploadImage(
    file: Express.Multer.File,
  ): Promise<UploadApiResponse | UploadApiErrorResponse> {
    return new Promise((resolve, reject) => {
      const upload = this.cloudinary.uploader.upload_stream((error, result) => {
        if (error) return reject(error);
        if (!result) return reject(new Error('Upload failed'));
        resolve(result);
      });

      toStream(file.buffer).pipe(upload);
    });
  }

  async uploadVideo(
    file: Express.Multer.File,
    folder?: string,
  ): Promise<UploadApiResponse | UploadApiErrorResponse> {
    return new Promise((resolve, reject) => {
      const upload = this.cloudinary.uploader.upload_stream(
        {
          resource_type: 'video',
          folder: folder || 'videos',
          chunk_size: 6000000, // 6MB chunks for large videos
        },
        (error, result) => {
          if (error) return reject(error);
          if (!result) return reject(new Error('Upload failed'));
          resolve(result);
        },
      );

      toStream(file.buffer).pipe(upload);
    });
  }

  async uploadFile(
    file: Express.Multer.File,
    options?: {
      folder?: string;
      resourceType?: 'image' | 'video' | 'raw' | 'auto';
    },
  ): Promise<UploadApiResponse | UploadApiErrorResponse> {
    return new Promise((resolve, reject) => {
      const upload = this.cloudinary.uploader.upload_stream(
        {
          resource_type: options?.resourceType || 'auto',
          folder: options?.folder || 'uploads',
        },
        (error, result) => {
          if (error) return reject(error);
          if (!result) return reject(new Error('Upload failed'));
          resolve(result);
        },
      );

      toStream(file.buffer).pipe(upload);
    });
  }

  // Additive only — every method above stays untouched (approved Vocabulary
  // Import Framework plan §8). Needed because none of them accept an
  // explicit public_id or overwrite flag: the import pipeline needs
  // deterministic ids (vocab/{audio|images}/{datasetId}/{textKey}) so a
  // re-import of the same word never orphans a previous asset, and
  // overwrite:false so a resumed run's re-upload of an already-uploaded
  // file is a safe no-op rather than a duplicate.
  async uploadBuffer(
    buffer: Buffer,
    options: {
      // Omit when publicId is already a full path (e.g.
      // "vocab/audio/<dataset>/<word>") — Cloudinary prepends folder onto
      // public_id, so passing both duplicates the path segment.
      folder?: string;
      publicId: string;
      resourceType: 'image' | 'video' | 'raw' | 'auto';
      overwrite?: boolean;
    },
  ): Promise<UploadApiResponse | UploadApiErrorResponse> {
    return new Promise((resolve, reject) => {
      const upload = this.cloudinary.uploader.upload_stream(
        {
          resource_type: options.resourceType,
          ...(options.folder && { folder: options.folder }),
          public_id: options.publicId,
          overwrite: options.overwrite ?? false,
        },
        (error, result) => {
          if (error) return reject(error);
          if (!result) return reject(new Error('Upload failed'));
          resolve(result);
        },
      );

      toStream(buffer).pipe(upload);
    });
  }

  async deleteImage(publicId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.cloudinary.uploader.destroy(publicId, (error, result) => {
        if (error) return reject(error);
        resolve(result);
      });
    });
  }

  async deleteVideo(publicId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.cloudinary.uploader.destroy(
        publicId,
        { resource_type: 'video' },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        },
      );
    });
  }

  async deleteFile(
    publicId: string,
    resourceType: 'image' | 'video' | 'raw' = 'image',
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      this.cloudinary.uploader.destroy(
        publicId,
        { resource_type: resourceType },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        },
      );
    });
  }
}
