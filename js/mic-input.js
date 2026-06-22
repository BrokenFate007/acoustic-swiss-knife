// js/mic-input.js
// Microphone input management with device enumeration

export class MicInput {
    constructor(kernel) {
        this.kernel = kernel;
        this.isCapturing = false;
        this.currentDeviceId = null;
    }

    async enumerateDevices() {
        try {
            // Request permission first (needed to get device labels)
            await navigator.mediaDevices.getUserMedia({ audio: true })
                .then(s => s.getTracks().forEach(t => t.stop()));

            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices
                .filter(d => d.kind === 'audioinput')
                .map(d => ({
                    deviceId: d.deviceId,
                    label: d.label || `Microphone ${d.deviceId.slice(0, 8)}`
                }));
        } catch (e) {
            console.error('[MicInput] Cannot enumerate devices:', e);
            return [];
        }
    }

    async startCapture(deviceId) {
        if (this.isCapturing) this.stopCapture();

        const success = await this.kernel.connectMic(deviceId || null);
        if (success) {
            this.isCapturing = true;
            this.currentDeviceId = deviceId;
        }
        return success;
    }

    stopCapture() {
        this.kernel.disconnectMic();
        this.isCapturing = false;
        this.currentDeviceId = null;
    }

    setAnalysisMode(mode) {
        this.kernel.setAnalysisMode(mode);
    }

    setMonitor(enabled) {
        this.kernel.setMonitor(enabled);
    }
}
