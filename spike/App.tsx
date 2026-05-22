import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native';
import { SpikeScreen } from './src/ui/SpikeScreen';

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <StatusBar style="auto" />
      <SpikeScreen />
    </SafeAreaView>
  );
}
