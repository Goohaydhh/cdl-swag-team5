import { Platform } from 'react-native';

/**
 * Base URL of the SWAG API. The Android emulator reaches the PC's localhost at 10.0.2.2;
 * a real phone needs the PC's LAN IP: set EXPO_PUBLIC_API_URL=http://192.168.1.20:3100.
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'android' ? 'http://10.0.2.2:3100' : 'http://localhost:3100');

export const DEVICE_NAME = Platform.OS === 'ios' ? 'iPhone' : 'Téléphone Android';
