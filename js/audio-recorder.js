// js/audio-recorder.js
// WAV recorder with 16-bit, 24-bit, and 32-bit float support.

export class AudioRecorder {
    constructor(kernel) {
        this.kernel = kernel;
        this.isRecording = false;
        this.startTime = 0;
        this.chunks = [];        // Array of Float32Array[] per channel
        this.channelCount = 2;
        this.scriptNode = null;
        this._silentGain = null; // Muted output so ScriptProcessor fires without doubling audio
        this.bitDepth = 32;      // 16, 24, or 32
        this.source = 'generator'; // 'generator' | 'mic' | 'both'
        this.onTick = null;      // Callback for duration updates
        this._tickInterval = null;
        this._connectedSources = []; // Track connections for clean disconnect
    }

    start() {
        if (this.isRecording || !this.kernel.ctx) return;

        const ctx = this.kernel.ctx;
        this.chunks = [];
        this.channelCount = 2;
        this._connectedSources = [];

        // Create a ScriptProcessorNode to capture raw PCM
        this.scriptNode = ctx.createScriptProcessor(4096, 2, 2);
        this.scriptNode.onaudioprocess = (e) => {
            if (!this.isRecording) return;
            const left = new Float32Array(e.inputBuffer.getChannelData(0));
            const right = new Float32Array(e.inputBuffer.getChannelData(1));
            this.chunks.push([left, right]);
        };

        // Route based on source
        if (this.source === 'mic' && this.kernel.micSource) {
            this.kernel.micSource.connect(this.scriptNode);
            this._connectedSources.push(this.kernel.micSource);
        } else if (this.source === 'both' && this.kernel.micSource) {
            this.kernel.masterGain.connect(this.scriptNode);
            this.kernel.micSource.connect(this.scriptNode);
            this._connectedSources.push(this.kernel.masterGain, this.kernel.micSource);
        } else {
            this.kernel.masterGain.connect(this.scriptNode);
            this._connectedSources.push(this.kernel.masterGain);
        }

        // Connect scriptNode to a SILENT gain node (not destination directly).
        // This ensures onaudioprocess fires without doubling the audio output.
        this._silentGain = ctx.createGain();
        this._silentGain.gain.value = 0;
        this._silentGain.connect(ctx.destination);
        this.scriptNode.connect(this._silentGain);

        this.isRecording = true;
        this.startTime = Date.now();

        // Duration tick
        this._tickInterval = setInterval(() => {
            if (this.onTick) {
                const elapsed = (Date.now() - this.startTime) / 1000;
                this.onTick(elapsed);
            }
        }, 250);

        console.log(`[Recorder] Started: ${this.source}, ${this.bitDepth}-bit`);
    }

    stop() {
        if (!this.isRecording) return null;
        this.isRecording = false;

        if (this._tickInterval) {
            clearInterval(this._tickInterval);
            this._tickInterval = null;
        }

        // Clean up audio connections
        for (const src of this._connectedSources) {
            try { src.disconnect(this.scriptNode); } catch (e) { /* already disconnected */ }
        }
        this._connectedSources = [];

        if (this.scriptNode) {
            this.scriptNode.disconnect();
            this.scriptNode = null;
        }
        if (this._silentGain) {
            this._silentGain.disconnect();
            this._silentGain = null;
        }

        // Guard: no chunks recorded
        if (this.chunks.length === 0) {
            console.warn('[Recorder] No audio data captured.');
            return null;
        }

        // Merge chunks and encode WAV
        const sampleRate = this.kernel.ctx.sampleRate;
        const merged = this._mergeChunks();
        const wavBlob = this._encodeWAV(merged, sampleRate);

        // Trigger download (delay revokeObjectURL so browser can finish)
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const link = document.createElement('a');
        link.download = `recording_${this.bitDepth}bit_${ts}.wav`;
        const url = URL.createObjectURL(wavBlob);
        link.href = url;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 5000);

        console.log(`[Recorder] Stopped. ${this.chunks.length} chunks, ${merged[0].length} samples.`);
        return wavBlob;
    }

    _mergeChunks() {
        const totalSamples = this.chunks.reduce((sum, c) => sum + c[0].length, 0);
        const channels = [];
        for (let ch = 0; ch < this.channelCount; ch++) {
            const merged = new Float32Array(totalSamples);
            let offset = 0;
            for (const chunk of this.chunks) {
                merged.set(chunk[ch], offset);
                offset += chunk[ch].length;
            }
            channels.push(merged);
        }
        return channels;
    }

    _encodeWAV(channels, sampleRate) {
        const numChannels = channels.length;
        const numSamples = channels[0].length;
        const bitDepth = this.bitDepth;
        const isFloat = (bitDepth === 32);

        const bytesPerSample = bitDepth / 8;
        const audioFormat = isFloat ? 3 : 1; // 3 = IEEE Float, 1 = PCM
        const blockAlign = numChannels * bytesPerSample;
        const byteRate = sampleRate * blockAlign;
        const dataSize = numSamples * blockAlign;

        // For IEEE float, we need an extended fmt chunk (18 bytes) + a fact chunk (12 bytes)
        const fmtChunkSize = isFloat ? 18 : 16;
        const factChunkSize = isFloat ? 12 : 0; // 'fact' + size(4) + dwSampleLength(4)
        const headerSize = 12 + (8 + fmtChunkSize) + factChunkSize + 8; // RIFF(12) + fmt(8+size) + fact? + data(8)
        const totalSize = headerSize + dataSize;

        const buffer = new ArrayBuffer(totalSize);
        const view = new DataView(buffer);
        let pos = 0;

        // RIFF header
        this._writeString(view, pos, 'RIFF'); pos += 4;
        view.setUint32(pos, totalSize - 8, true); pos += 4;
        this._writeString(view, pos, 'WAVE'); pos += 4;

        // fmt sub-chunk
        this._writeString(view, pos, 'fmt '); pos += 4;
        view.setUint32(pos, fmtChunkSize, true); pos += 4;
        view.setUint16(pos, audioFormat, true); pos += 2;
        view.setUint16(pos, numChannels, true); pos += 2;
        view.setUint32(pos, sampleRate, true); pos += 4;
        view.setUint32(pos, byteRate, true); pos += 4;
        view.setUint16(pos, blockAlign, true); pos += 2;
        view.setUint16(pos, bitDepth, true); pos += 2;
        if (isFloat) {
            view.setUint16(pos, 0, true); pos += 2; // cbSize = 0 (extension size)
        }

        // fact sub-chunk (required for non-PCM formats)
        if (isFloat) {
            this._writeString(view, pos, 'fact'); pos += 4;
            view.setUint32(pos, 4, true); pos += 4;         // fact chunk data size
            view.setUint32(pos, numSamples, true); pos += 4; // dwSampleLength
        }

        // data sub-chunk
        this._writeString(view, pos, 'data'); pos += 4;
        view.setUint32(pos, dataSize, true); pos += 4;

        // Interleaved samples
        for (let i = 0; i < numSamples; i++) {
            for (let ch = 0; ch < numChannels; ch++) {
                const sample = Math.max(-1, Math.min(1, channels[ch][i]));

                if (bitDepth === 16) {
                    view.setInt16(pos, Math.round(sample * 32767), true);
                    pos += 2;
                } else if (bitDepth === 24) {
                    const val = Math.round(sample * 8388607);
                    view.setUint8(pos, val & 0xFF);
                    view.setUint8(pos + 1, (val >> 8) & 0xFF);
                    view.setUint8(pos + 2, (val >> 16) & 0xFF);
                    pos += 3;
                } else {
                    view.setFloat32(pos, sample, true);
                    pos += 4;
                }
            }
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }

    _writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }
}
