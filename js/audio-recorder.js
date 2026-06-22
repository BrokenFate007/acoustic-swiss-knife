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
        this.bitDepth = 32;      // 16, 24, or 32
        this.source = 'generator'; // 'generator' | 'mic' | 'both'
        this.onTick = null;      // Callback for duration updates
        this._tickInterval = null;
    }

    start() {
        if (this.isRecording || !this.kernel.ctx) return;

        const ctx = this.kernel.ctx;
        this.chunks = [];
        this.channelCount = 2;

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
        } else if (this.source === 'both' && this.kernel.micSource) {
            this.kernel.masterGain.connect(this.scriptNode);
            this.kernel.micSource.connect(this.scriptNode);
        } else {
            this.kernel.masterGain.connect(this.scriptNode);
        }

        // Connect to destination (pass-through, required for ScriptProcessor to fire)
        this.scriptNode.connect(ctx.destination);

        this.isRecording = true;
        this.startTime = Date.now();

        // Duration tick
        if (this.onTick) {
            this._tickInterval = setInterval(() => {
                if (this.onTick) {
                    const elapsed = (Date.now() - this.startTime) / 1000;
                    this.onTick(elapsed);
                }
            }, 250);
        }
    }

    stop() {
        if (!this.isRecording) return null;
        this.isRecording = false;

        if (this._tickInterval) {
            clearInterval(this._tickInterval);
            this._tickInterval = null;
        }

        if (this.scriptNode) {
            this.scriptNode.disconnect();
            this.scriptNode = null;
        }

        // Merge chunks and encode WAV
        const sampleRate = this.kernel.ctx.sampleRate;
        const merged = this._mergeChunks();
        const wavBlob = this._encodeWAV(merged, sampleRate);

        // Trigger download
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const link = document.createElement('a');
        link.download = `recording_${this.bitDepth}bit_${ts}.wav`;
        link.href = URL.createObjectURL(wavBlob);
        link.click();
        URL.revokeObjectURL(link.href);

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

        let bytesPerSample;
        let audioFormat;

        if (bitDepth === 16) {
            bytesPerSample = 2;
            audioFormat = 1; // PCM
        } else if (bitDepth === 24) {
            bytesPerSample = 3;
            audioFormat = 1; // PCM
        } else {
            bytesPerSample = 4;
            audioFormat = 3; // IEEE Float
        }

        const blockAlign = numChannels * bytesPerSample;
        const byteRate = sampleRate * blockAlign;
        const dataSize = numSamples * blockAlign;
        const headerSize = 44;
        const buffer = new ArrayBuffer(headerSize + dataSize);
        const view = new DataView(buffer);

        // RIFF header
        this._writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        this._writeString(view, 8, 'WAVE');

        // fmt sub-chunk
        this._writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);            // Sub-chunk size
        view.setUint16(20, audioFormat, true);    // Audio format
        view.setUint16(22, numChannels, true);    // Num channels
        view.setUint32(24, sampleRate, true);     // Sample rate
        view.setUint32(28, byteRate, true);       // Byte rate
        view.setUint16(32, blockAlign, true);     // Block align
        view.setUint16(34, bitDepth, true);       // Bits per sample

        // data sub-chunk
        this._writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        // Interleaved samples
        let offset = 44;
        for (let i = 0; i < numSamples; i++) {
            for (let ch = 0; ch < numChannels; ch++) {
                const sample = Math.max(-1, Math.min(1, channels[ch][i]));

                if (bitDepth === 16) {
                    const val = Math.round(sample * 32767);
                    view.setInt16(offset, val, true);
                    offset += 2;
                } else if (bitDepth === 24) {
                    const val = Math.round(sample * 8388607);
                    view.setUint8(offset, val & 0xFF);
                    view.setUint8(offset + 1, (val >> 8) & 0xFF);
                    view.setUint8(offset + 2, (val >> 16) & 0xFF);
                    offset += 3;
                } else {
                    view.setFloat32(offset, sample, true);
                    offset += 4;
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
