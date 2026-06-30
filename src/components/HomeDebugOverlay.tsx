import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { GameWithPrediction } from '@/types/sports';
import { isVerifiedScoreboardGame } from '@/lib/verified-games';
import { parseGameTime, getLocalDateStr } from '@/lib/game-time';
import { OTA_REVISION } from '@/lib/app-version';
import { getGamesProbe } from '@/lib/debug-net-probe';

// TEMPORARY on-device diagnostic. Mounted on Home to report — from the real
// device — exactly which stage drops the board to 0: fetch, verified-filter,
// or date-parse. Remove once the blank-board issue is resolved.

function todayLocalStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function HomeDebugOverlay() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(true);
  const [tick, setTick] = useState(0);

  // Re-read the cache periodically so the panel reflects live fetch results.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1500);
    return () => clearInterval(id);
  }, []);

  const report = useMemo(() => {
    const raw = queryClient.getQueryData<GameWithPrediction[]>(['games']);
    const rawArr = Array.isArray(raw) ? raw : [];
    const rawCount = rawArr.length;

    // Stage 2: verified filter
    let verifiedCount = 0;
    const sportCount: Record<string, number> = {};
    // Stage 3: date parse
    let validDate = 0;
    let invalidDate = 0;
    let scheduledToday = 0;
    const todayStr = todayLocalStr();
    const sampleTimes: string[] = [];
    const failReasons: Record<string, number> = {};

    for (const g of rawArr) {
      const verified = isVerifiedScoreboardGame(g as any);
      if (verified) verifiedCount += 1;
      else {
        // why dropped?
        const sport = String((g as any).sport ?? '').toUpperCase();
        const idOk = /^\d+$/.test(String((g as any).id ?? ''));
        const key = !sport ? 'no-sport' : !idOk ? `id:${String((g as any).id).slice(0, 8)}` : `sport:${sport}`;
        failReasons[key] = (failReasons[key] ?? 0) + 1;
      }

      const d = parseGameTime((g as any).gameTime);
      if (d) validDate += 1; else invalidDate += 1;
      if (sampleTimes.length < 4 && (g as any).gameTime) sampleTimes.push(String((g as any).gameTime));

      const ds = getLocalDateStr((g as any).gameTime);
      if (verified && String((g as any).status) === 'SCHEDULED' && ds === todayStr) {
        scheduledToday += 1;
        const sp = String((g as any).sport ?? '?');
        sportCount[sp] = (sportCount[sp] ?? 0) + 1;
      }
    }

    return {
      rawCount, verifiedCount, validDate, invalidDate, scheduledToday,
      todayStr, sportCount, sampleTimes, failReasons,
    };
  }, [queryClient, tick]);

  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
        style={{ position: 'absolute', top: 6, right: 6, zIndex: 9999, backgroundColor: '#7A9DB8', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}
      >
        <Text style={{ color: '#04060A', fontSize: 10, fontWeight: '900' }}>DBG</Text>
      </Pressable>
    );
  }

  const line = (label: string, value: string | number, warn = false) => (
    <Text style={{ color: warn ? '#FF6B6B' : '#9BB8CF', fontSize: 11, fontWeight: '700', marginBottom: 1 }}>
      {label}: <Text style={{ color: '#FFFFFF' }}>{String(value)}</Text>
    </Text>
  );

  return (
    <View style={{ position: 'absolute', top: 4, left: 8, right: 8, zIndex: 9999, backgroundColor: 'rgba(4,6,10,0.96)', borderColor: '#7A9DB8', borderWidth: 1, borderRadius: 10, padding: 10, maxHeight: 320 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <Text style={{ color: '#7A9DB8', fontSize: 12, fontWeight: '900' }}>CLUTCH DEBUG · {OTA_REVISION}</Text>
        <Pressable onPress={() => setOpen(false)} hitSlop={10}>
          <Text style={{ color: '#FF6B6B', fontSize: 12, fontWeight: '900' }}>HIDE</Text>
        </Pressable>
      </View>
      <ScrollView style={{ maxHeight: 280 }}>
        {line('OTA running', OTA_REVISION, OTA_REVISION !== 'r14')}
        {line('today (device local)', report.todayStr)}
        {(() => { const p = getGamesProbe(); return (
          <View style={{ borderTopColor: '#5A7A8A', borderTopWidth: 1, marginTop: 4, paddingTop: 4 }}>
            <Text style={{ color: '#7A9DB8', fontSize: 11, fontWeight: '900' }}>RAW NETWORK FETCH</Text>
            {p ? (<>
              {line('net status', p.status, p.status !== 200)}
              {line('net raw count', p.rawCount, p.rawCount < 200)}
              {p.error ? <Text style={{ color: '#FF6B6B', fontSize: 10 }}>net error: {p.error}</Text> : null}
              <Text style={{ color: '#9BB8CF', fontSize: 9 }}>{p.url}</Text>
              <Text style={{ color: '#9BB8CF', fontSize: 10 }}>sample: {p.sample ? `${p.sample.sport} ${p.sample.gameTime}` : 'none'}</Text>
            </>) : (<Text style={{ color: '#FF6B6B', fontSize: 10 }}>no /api/games fetch recorded yet</Text>)}
          </View>
        ); })()}
        {line('raw games in cache', report.rawCount, report.rawCount === 0)}
        {line('passed verified-filter', report.verifiedCount, report.verifiedCount === 0 && report.rawCount > 0)}
        {line('valid gameTime parse', report.validDate, report.validDate === 0 && report.rawCount > 0)}
        {line('INVALID gameTime parse', report.invalidDate, report.invalidDate > 0)}
        {line('SCHEDULED today (tiles)', report.scheduledToday, report.scheduledToday === 0 && report.verifiedCount > 0)}
        <Text style={{ color: '#9BB8CF', fontSize: 11, fontWeight: '700', marginTop: 4 }}>today by sport: <Text style={{ color: '#FFF' }}>{JSON.stringify(report.sportCount)}</Text></Text>
        {report.rawCount > 0 && report.verifiedCount === 0 ? (
          <Text style={{ color: '#FF6B6B', fontSize: 11, fontWeight: '700', marginTop: 4 }}>filter drops: <Text style={{ color: '#FFF' }}>{JSON.stringify(report.failReasons)}</Text></Text>
        ) : null}
        <Text style={{ color: '#5A7A8A', fontSize: 10, marginTop: 4 }}>sample times:</Text>
        {report.sampleTimes.map((t, i) => (
          <Text key={i} style={{ color: '#9BB8CF', fontSize: 10 }}>{t}</Text>
        ))}
        {report.rawCount === 0 ? (
          <Text style={{ color: '#FF6B6B', fontSize: 11, fontWeight: '700', marginTop: 4 }}>RAW=0 → fetch never populated cache (network/auth/parse before filter)</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
