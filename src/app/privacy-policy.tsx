import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';

export default function PrivacyPolicyScreen() {
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={{ flex: 1, backgroundColor: '#040608' }} edges={['top']}>
        {/* Header */}
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(255,255,255,0.06)',
        }}>
          <Pressable
            onPress={() => router.back()}
            style={{ marginRight: 16, padding: 4 }}
          >
            <ChevronLeft size={28} color="#fff" />
          </Pressable>
          <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700' }}>
            Privacy Policy
          </Text>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 22 }}>
{`Privacy Policy
Effective Date: March 1, 2026  ·  Last Updated: March 1, 2026

This Privacy Policy explains how Clutch Picks ("Clutch Picks," "we," "us," or "our") collects, uses, discloses, and protects information when you use the Clutch Picks mobile application and any related services (collectively, the "App").

Clutch Picks is a sports game tracking and prediction app. Users can make "picks" for personal tracking and entertainment. Clutch Picks does not offer gambling services, does not accept wagers, does not process payments for betting, and does not facilitate real-money betting or trading.

By using the App, you agree to the practices described in this Privacy Policy.

1. INFORMATION WE COLLECT

We collect information in three ways: (a) information you provide, (b) information collected automatically, and (c) information from third parties (if you choose to connect them).

A. Information You Provide
• Account information: such as username, email address, and login credentials (or authentication token if you use a third-party sign-in such as Apple).
• Profile and preferences: such as favorite teams, notification preferences, and display settings.
• Picks and activity: picks you create, watchlists, favorites, and other actions taken inside the App.
• Support communications: information you provide if you contact support.

B. Information Collected Automatically
• Device and app information: device type, operating system version, app version, language, time zone, and IP address.
• Usage information: pages/screens viewed, features used, session times, interaction events, and referral information.
• Diagnostics and performance data: crash reports, error logs, and performance metrics.

C. Information From Third Parties (Optional)
If you sign in using a third-party provider (e.g., Apple, Google), we may receive limited information such as a unique account identifier and basic profile details permitted by your settings with that provider.

2. HOW WE USE INFORMATION

We use information to:
• Provide and operate the App, including creating and maintaining accounts and enabling features such as picks tracking.
• Personalize your experience, including showing relevant games, teams, and notifications.
• Improve and secure the App, including troubleshooting, preventing abuse, detecting fraud, and maintaining system integrity.
• Communicate with you, including responding to support requests and sending service-related messages.
• Analytics, to understand usage trends and improve performance and user experience.
• Legal and compliance purposes, such as enforcing policies and complying with lawful requests.

3. HOW WE SHARE INFORMATION

We do not sell your personal information.

We may share information in the following limited cases:
• Service providers: vendors that help us operate the App. They are permitted to process information only on our instructions and for the services they provide to us. These include:
  - ESPN (sports data and scores)
  - OpenAI (AI-powered prediction analysis — game context is sent for analysis but no personal data is shared)
  - RevenueCat (subscription and payment processing)
  - Apple (authentication via Sign in with Apple)
• Legal and safety reasons: if we believe disclosure is necessary to comply with law, court order, or valid legal process; to protect rights, safety, and security of Clutch Picks, our users, or others; or to investigate fraud, abuse, or security incidents.
• Business transfers: if we are involved in a merger, acquisition, financing, reorganization, bankruptcy, or sale of assets, information may be transferred as part of that transaction.

4. ADVERTISING AND ANALYTICS

Advertising and analytics partners may collect or receive certain information to measure performance and prevent fraud. This may include:
• Device identifiers (such as an advertising ID where permitted)
• IP address
• App interaction events (e.g., session data)
• Device and app information (device model, OS version, app version)

Your choices and controls:
• You can limit ad tracking or reset your advertising identifier using your device settings.
• On iOS, you can control whether apps can request to track you (App Tracking Transparency) and manage tracking permissions in system settings.

5. LOCATION DATA

Clutch Picks does not require precise location data to function. If the App ever requests location permissions, it will be optional and used only for the purpose disclosed at the time you grant permission. You can disable location permissions at any time in your device settings.

6. DATA RETENTION

We retain information only as long as reasonably necessary to:
• Provide the App
• Comply with legal obligations
• Resolve disputes
• Enforce agreements
• Maintain security and prevent abuse

We may retain aggregated or de-identified information for analytics and product improvement.

7. ACCOUNT DELETION AND YOUR PRIVACY RIGHTS

You may request deletion of your account and associated personal information by emailing support@clutchpicksapp.com from the email address linked to your account.

When we delete your account, we remove or de-identify personal information associated with the account, subject to limited exceptions where retention is required or permitted by law.

Depending on where you live, you may have additional rights such as accessing, correcting, or deleting certain personal information. You can exercise these rights by contacting us at support@clutchpicksapp.com.

8. SECURITY

We use reasonable administrative, technical, and organizational safeguards designed to protect information. However, no method of transmission or storage is 100% secure. You use the App at your own risk.

9. CHILDREN'S PRIVACY

The App is not intended for children under 13 (or the minimum age required in your jurisdiction). We do not knowingly collect personal information from children under 13. If you believe a child has provided us personal information, contact support@clutchpicksapp.com and we will take appropriate steps to delete it.

10. INTERNATIONAL USERS

If you access the App from outside the United States, you understand that information may be processed and stored in the United States or other countries where our service providers operate. Those countries may have different data protection laws than your jurisdiction.

11. THIRD-PARTY LINKS AND SERVICES

The App may include links to third-party sites or services. We are not responsible for the privacy practices of third parties. Your use of third-party services is governed by their policies.

12. SPORTS PREDICTIONS, PICKS, AND NO GAMBLING

Clutch Picks provides sports tracking, prediction features, and tools that allow you to record picks for personal use.
• No wagering: The App does not enable placing bets, staking money, trading contracts, or participating in gambling through the App.
• Entertainment and informational use: predictions, rankings, and picks are provided for informational/entertainment purposes and may be incorrect.
• User responsibility: you are responsible for how you use information from the App.

13. CHANGES TO THIS PRIVACY POLICY

We may update this Privacy Policy from time to time. If we make material changes, we will provide notice within the App and/or update the "Last Updated" date above. Your continued use of the App after an update means you accept the updated policy.

14. CONTACT US

If you have questions, requests, or complaints about this Privacy Policy, contact us at:

Email: support@clutchpicksapp.com`}
          </Text>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}
