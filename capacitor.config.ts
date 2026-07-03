import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.webcashglobal.tripmemo',
  appName: 'TripMemo',
  webDir: 'dist',
  ios: {
    scheme: 'TripMemo',
  },
};

export default config;
