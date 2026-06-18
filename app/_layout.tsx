import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#f4f8f6' },
        headerTitleStyle: { color: '#17211f' },
        contentStyle: { backgroundColor: '#f4f8f6' },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="library" options={{ title: 'Library' }} />
      <Stack.Screen name="session" options={{ title: 'Read' }} />
    </Stack>
  );
}
