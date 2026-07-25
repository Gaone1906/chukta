import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: 'transparent' },
        // The onboarding flow is linear, so a plain slide reads correctly. The ripple is for
        // lateral moves inside the app, not for stepping through a wizard.
        animation: 'slide_from_right',
      }}
    />
  );
}
