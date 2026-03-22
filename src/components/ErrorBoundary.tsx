import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

interface Props {
  children: React.ReactNode;
  onGoBack?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { onGoBack } = this.props;
    if (!error) return this.props.children;

    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.subtitle}>The app ran into an unexpected error.</Text>
          {__DEV__ === true && (
            <Text style={styles.errorText} numberOfLines={4}>
              {error.message}
            </Text>
          )}
          <View style={styles.buttonRow}>
            <Pressable
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              onPress={this.reset}
            >
              <Text style={styles.buttonText}>Try Again</Text>
            </Pressable>
            {onGoBack ? (
              <Pressable
                style={({ pressed }) => [styles.button, styles.buttonSecondary, pressed && styles.buttonPressed]}
                onPress={onGoBack}
              >
                <Text style={styles.buttonText}>Go Back</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    alignItems: 'center',
    maxWidth: 320,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    lineHeight: 22,
  },
  errorText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.3)',
    textAlign: 'center',
    fontFamily: 'monospace',
    marginTop: 4,
    lineHeight: 18,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  button: {
    backgroundColor: '#5A7A8A',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
  },
  buttonSecondary: {
    backgroundColor: '#2A3A44',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
});
