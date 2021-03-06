/**
 * @flow
 * @file Represents a chunked part of a file - used by the chunked upload API
 * @author Box
 */

import noop from 'lodash.noop';
import Base from './Base';
import type { StringMap } from '../flowTypes';

const UPLOAD_RETRY_INTERVAL_MS = 1000;

class Chunk extends Base {
    cancelled: boolean;
    chunk: ?Blob;
    data: Object = {};
    progress: number = 0;
    retry: number;
    uploadHeaders: StringMap;
    uploadUrl: string;
    successCallback: Function;
    errorCallback: Function;
    progressCallback: Function;

    /**
     * Returns file part associated with this chunk.
     *
     * @return {Object}
     */
    getPart() {
        return this.data.part;
    }

    /**
     * Setup chunk for uploading.
     *
     * @param {Object} options
     * @param {string} options.sessionId - ID of upload session that this chunk belongs to
     * @param {Blob} options.part - Chunk blob
     * @param {number} options.offset = Chunk offset
     * @param {string} options.sha1 - Chunk sha1
     * @param {number} options.totalSize - Total size of file that this chunk belongs to
     * @param {Function} [options.successCallback] - Chunk upload success callback
     * @param {Function} [options.errorCallback] - Chunk upload error callback
     * @param {Function} [options.progressCallback] - Chunk upload progress callback
     * @return {Promise}
     */
    setup({
        sessionId,
        part,
        offset,
        sha1,
        totalSize,
        successCallback = noop,
        errorCallback = noop,
        progressCallback = noop
    }: {
        sessionId: string,
        part: Blob,
        offset: number,
        sha1: string,
        totalSize: number,
        successCallback?: Function,
        errorCallback?: Function,
        progressCallback?: Function
    }): void {
        this.uploadUrl = `${this.uploadHost}/api/2.0/files/upload_sessions/${sessionId}`;

        // Calculate range
        const rangeStart = offset;
        let rangeEnd = offset + part.size - 1;
        if (rangeEnd > totalSize - 1) {
            rangeEnd = totalSize - 1;
        }

        this.uploadHeaders = {
            'Content-Type': 'application/octet-stream',
            Digest: `SHA=${sha1}}`,
            'Content-Range': `bytes ${rangeStart}-${rangeEnd}/${totalSize}`
        };

        this.chunk = part;
        this.successCallback = successCallback;
        this.errorCallback = errorCallback;
        this.progressCallback = progressCallback;
    }

    /**
     * Uploads this chunk via the API. Will retry on network failures.
     *
     * @returns {void}
     */
    upload(): void {
        if (this.isDestroyed()) {
            this.chunk = null;
            return;
        }

        this.xhr.uploadFile({
            url: this.uploadUrl,
            data: this.chunk,
            headers: this.uploadHeaders,
            method: 'PUT',
            successHandler: (data) => {
                this.progress = 1;
                this.data = data;
                this.chunk = null;
                this.successCallback(data);
            },
            errorHandler: (err) => {
                // If there's an error code and it's not 429 from rate limiting, fail the upload
                if (err.code && err.code !== 429) {
                    this.cancel();
                    this.errorCallback(err);

                    // Retry on other failures since these are likely to be network errors
                } else {
                    this.retry = setTimeout(() => this.upload(), UPLOAD_RETRY_INTERVAL_MS);
                }
            },
            progressHandler: this.progressCallback
        });
    }

    /**
     * Cancels upload for this chunk.
     *
     * @returns {void}
     */
    cancel(): void {
        if (this.xhr && typeof this.xhr.abort === 'function') {
            this.xhr.abort();
        }

        clearTimeout(this.retry);
        this.chunk = null;
        this.data = {};
        this.destroy();
    }

    /**
     * Returns progress. Progress goes from 0-1.
     *
     * @return {number} Progress from 0-1
     */
    getProgress(): number {
        return this.progress;
    }

    /**
     * Set progress.
     *
     * @param {number} progress - Numerical progress
     */
    setProgress(progress: number): void {
        this.progress = progress;
    }
}

export default Chunk;
