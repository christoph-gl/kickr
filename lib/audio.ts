class AudioService {
  private notificationAudio: HTMLAudioElement | null = null;
  private accelerateAudio: HTMLAudioElement | null = null;
  private brakeAudio: HTMLAudioElement | null = null;

  init() {
    if (typeof window === 'undefined') return;
    
    if (!this.notificationAudio) {
      this.notificationAudio = new Audio('/notification.mp3');
      this.accelerateAudio = new Audio('/accelerate.mp3');
      this.brakeAudio = new Audio('/brake.mp3');
    }
  }

  playNotification() {
    this.init();
    if (this.notificationAudio) {
      this.notificationAudio.currentTime = 0;
      this.notificationAudio.play().catch(e => console.error("Error playing notification:", e));
    }
  }

  playAcceleration() {
    this.init();
    if (this.accelerateAudio) {
      this.accelerateAudio.currentTime = 0;
      this.accelerateAudio.play().catch(e => console.error("Error playing acceleration:", e));
    }
  }

  playDeceleration() {
    this.init();
    if (this.brakeAudio) {
      this.brakeAudio.currentTime = 0;
      this.brakeAudio.play().catch(e => console.error("Error playing deceleration:", e));
    }
  }
}

export const audioService = new AudioService();

