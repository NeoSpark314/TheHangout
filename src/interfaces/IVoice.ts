export interface IAudioChunkPayload {
    chunk: string;
    isHeader: boolean;
}

export interface IVoiceStreamReceivedEvent {
    peerId: string;
    stream: MediaStream;
}

export interface IVoiceStreamReceiver {
    attachVoiceStream(stream: MediaStream): void;
}

export interface IAudioChunkReceiver {
    onAudioChunk(payload: IAudioChunkPayload): void;
}
