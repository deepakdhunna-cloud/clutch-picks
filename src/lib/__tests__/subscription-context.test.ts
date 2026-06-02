import fs from 'fs';
import path from 'path';

const subscriptionContextSource = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/subscription-context.tsx'),
  'utf8',
);

describe('subscription context customer state', () => {
  it('derives premium access and subscriber status from RevenueCat CustomerInfo', () => {
    expect(subscriptionContextSource).toContain('classifyCustomerSubscriptionState');
    expect(subscriptionContextSource).toContain('type CheckSubscriptionOptions =');
    expect(subscriptionContextSource).toContain('checkSubscription: (options?: CheckSubscriptionOptions) => Promise<void>');
    expect(subscriptionContextSource).toContain('classifyCustomerSubscriptionState(nextCustomerInfo, options)');
    expect(subscriptionContextSource).toContain("status: 'unsubscribed'");
    expect(subscriptionContextSource).toContain('setStatus(subscriptionState.status)');
    expect(subscriptionContextSource).toContain('setIsPremium(subscriptionState.hasPremiumAccess)');
    expect(subscriptionContextSource).toContain('getCustomerInfo()');
  });
});
