/**
 * Privacy Policy and Terms of Use shown in the app (Profile → Legal) and
 * exported to docs/legal/*.md for hosting (`npm run legal:export`).
 *
 * DRAFT: written to match what the code actually does, but NOT reviewed by a
 * lawyer. `reviewed` must be set to true (after legal review) before
 * `npm run release:check` passes. Replace every [BRACKETED] placeholder.
 */

export interface LegalDoc {
  title: string;
  updated: string;
  reviewed: boolean;
  sections: { heading: string; body: string[] }[];
}

export const PRIVACY: LegalDoc = {
  title: 'Privacy Policy',
  updated: '[EFFECTIVE DATE]',
  reviewed: false,
  sections: [
    {
      heading: 'Summary',
      body: [
        'Only Ads does not require an account. Your saved offers, shopping lists and activity history stay on your device; only the categories you picked and a coarse summary of your category preferences are sent with offer requests, and our server doesn’t keep them. We do not sell your personal information, we do not track you across other companies’ apps or websites, and we do not share your location with advertisers.',
      ],
    },
    {
      heading: 'Information stored only on your device',
      body: [
        'The categories you choose, offers you save, your shopping lists, offers you hide, brands you mute, your recent searches, and counts of how often you open, save or dismiss offers in each category. This is used to rank offers for you on your device. You can view and reset it under Profile, or erase all of it with “Erase all my data”. Uninstalling the app also deletes it.',
      ],
    },
    {
      heading: 'Information sent to our servers',
      body: [
        'To show offers, the app requests them from our server. So that the server can rank its whole catalog for you, each request includes the categories you picked and, for categories you have engaged with, a coarse level (for example “likes a lot” or “not interested”). It never includes your saved offers, lists, searches, the brands you engage with, or any identifier. The server uses this only to answer that request and does not store or log it.',
        'If you turn on location, the request includes your approximate location rounded to about 1 km; otherwise it includes no location. Our server uses it only to choose nearby offers for that request and does not store it.',
        'When you tap an offer’s button, the request passes through our server so we can check the link is still safe and count clicks per offer. We store the offer and the number of clicks per day — not who clicked.',
        'If “Anonymous usage stats” is on (you choose during setup and can change it under You), the app sends daily counts of events such as app opens, searches (only how many results, never what you searched), category taps, offer views, saves and clicks. These carry no account, device ID, advertising ID or location, and are stored only as daily totals. Ad views are counted per offer so advertisers can see how often their offer was shown.',
        'For advertisers who have authorized it, the link you open may include a campaign name and a random click code so the advertiser can attribute the visit. The click code is not linked to you or your device and is deleted after 90 days. A click is never recorded as a purchase.',
        'Like any internet service, our servers receive your IP address with each request. We use it only temporarily to protect the service from abuse (rate limiting) and do not store it in logs or link it to any profile.',
      ],
    },
    {
      heading: 'Reminders',
      body: [
        'If you turn on saved-deal reminders, the app asks for permission to show notifications and schedules them on your device. No push token is created and nothing about your reminders is sent to us.',
      ],
    },
    {
      heading: 'Location',
      body: [
        'Location is optional and only requested when you ask for nearby deals. We request approximate location only, while the app is in use, never in the background. You can turn it off in Profile or in your device settings.',
      ],
    },
    {
      heading: 'Advertisers and links',
      body: [
        'Offers are provided by advertisers and affiliate partners. Sponsored placements and affiliate links are labeled. When you open an advertiser’s website, their privacy policy applies to what you do there, and affiliate partners may record that the visit came from Only Ads in order to pay us a commission.',
      ],
    },
    {
      heading: 'Diagnostics',
      body: [
        '[IF ENABLED] We collect crash reports and error messages to fix problems. Reports are scrubbed of locations, emails, and URLs’ query parameters and are not linked to your identity.',
      ],
    },
    {
      heading: 'Children',
      body: ['Only Ads is not directed to children under 13 [or the minimum age in your country], and we do not knowingly collect their personal information.'],
    },
    {
      heading: 'Your rights and contact',
      body: [
        'Because we don’t keep personal profiles on our servers, deleting the app or using “Erase all my data” removes your data. For questions or requests under applicable laws (such as GDPR or CCPA), contact [CONTACT EMAIL]. [COMPANY LEGAL NAME, ADDRESS].',
      ],
    },
    {
      heading: 'Changes',
      body: ['We will post changes here and update the date above. Material changes will be highlighted in the app.'],
    },
  ],
};

export const TERMS: LegalDoc = {
  title: 'Terms of Use',
  updated: '[EFFECTIVE DATE]',
  reviewed: false,
  sections: [
    {
      heading: 'What Only Ads is',
      body: [
        'Only Ads shows offers, products and promotions from third-party advertisers and affiliate partners. We are not the seller. Purchases happen on the advertiser’s website or in their store, under their terms.',
      ],
    },
    {
      heading: 'Offers and accuracy',
      body: [
        'Advertisers supply offer details. We check offers automatically and remove ones that are expired or that we find misleading, but prices, availability and promo codes can change and are confirmed by the advertiser at checkout. Report a misleading offer from its detail page.',
      ],
    },
    {
      heading: 'Sponsored content and affiliate links',
      body: ['Some placements are paid (“Sponsored”), and some links earn us a commission (“Affiliate link”). Payment can influence placement only as a tie-breaker, never over relevance to you.'],
    },
    {
      heading: 'Acceptable use',
      body: ['Don’t scrape, overload, or attempt to disrupt the service, and don’t use it for unlawful purposes.'],
    },
    {
      heading: 'Disclaimers and liability',
      body: ['[TO BE COMPLETED BY COUNSEL: warranty disclaimer, limitation of liability, governing law, dispute resolution.]'],
    },
    {
      heading: 'Contact',
      body: ['[CONTACT EMAIL]'],
    },
  ],
};

export const LEGAL_DOCS = { privacy: PRIVACY, terms: TERMS } as const;
export type LegalDocId = keyof typeof LEGAL_DOCS;
