import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { supabase } from '../data/supabase';
import { Button } from '../ui/components';
import { colors, space } from '../ui/theme';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function verify() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setError(error.message);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.wrap}>
      <Text style={s.logo}>PacePath</Text>
      <Text style={s.tag}>Run the city's best loops. Beat the record.</Text>
      <View style={{ height: space.xl }} />
      {!sent ? (
        <>
          <TextInput
            style={s.input}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <Button title="Email me a code" onPress={sendCode} loading={busy} disabled={!email.includes('@')} />
        </>
      ) : (
        <>
          <Text style={s.hint}>Enter the code we sent to {email}</Text>
          <TextInput
            style={[s.input, s.code]}
            placeholder="123456"
            keyboardType="number-pad"
            autoComplete="one-time-code"
            value={code}
            onChangeText={setCode}
            maxLength={10}
          />
          <Button title="Sign in" onPress={verify} loading={busy} disabled={code.trim().length < 6} />
          <Button title="Use a different email" variant="secondary" style={{ marginTop: space.sm }} onPress={() => setSent(false)} />
        </>
      )}
      {error && <Text style={s.error}>{error}</Text>}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: space.xl, backgroundColor: colors.bg },
  logo: { fontSize: 40, fontWeight: '900', color: colors.primary },
  tag: { fontSize: 16, color: colors.muted, marginTop: space.xs },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12,
    padding: space.md, fontSize: 17, marginBottom: space.md,
  },
  code: { letterSpacing: 6, fontSize: 24, textAlign: 'center' },
  hint: { color: colors.muted, marginBottom: space.sm },
  error: { color: colors.bad, marginTop: space.md },
});
