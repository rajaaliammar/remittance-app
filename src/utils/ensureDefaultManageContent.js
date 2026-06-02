import prisma from './prisma.js';

/** Default CMS sections for the public website (mirrors portal remittanceHomeDefaults). */
const DEFAULT_MANAGE_CONTENT = {
  hero: {
    title: 'Fast and safe money transfers from {{senderCountry}}',
    description:
      'Move your money where it matters. Send from {{senderCountry}} in {{senderCurrency}} to {{receiverCountry}} — no hidden fees.',
    button: 'Open An Account',
    buttonUrl: '/signup',
    appStoreRating: '4.8',
    appStoreReview: '1.4M reviews',
    playStoreRating: '4.8',
    playStoreReview: '1.2M reviews',
  },
  safe: {
    title: 'Keep Money Safe',
    subTitle: 'Experience that Grows with Your Scale',
    items: [
      {
        id: '1',
        title: '24/7 customer support',
        shortDescription: 'Get assistance with your transfers whenever you need it.',
        iconType: 'CustomerServiceOutlined',
      },
      {
        id: '2',
        title: 'Global reach',
        shortDescription: 'Send money to family and friends across the world.',
        iconType: 'TeamOutlined',
      },
      {
        id: '3',
        title: 'Secure transfers',
        shortDescription: 'Your money is protected with industry-leading security.',
        iconType: 'HomeOutlined',
      },
    ],
  },
  whyChoose: {
    title: 'Why People Choose Remitta',
    subTitle: 'Best Remittance Solution For Money Sending',
    counterBoxCount: '4',
    counterBoxCountPrefix: 'M+',
    counterBoxTitle: 'Business Already Running on Remitta',
    counterBoxShortDescription:
      'Move your money where it matters. Save on international transfers in over 50 currencies, without hidden fees.',
    withdrawBoxTitle: 'Instant Withdraw your fund at any time',
    transferWayBoxTitle: 'Easy Money Transfer Way',
    transferWayBoxShortDescription:
      'Try our secure and easy-to-use money transfer app for better and easy solutions.',
    pickupBoxTitle: 'Cash pickup',
    pickupBoxSubTitle: 'You may quickly send money for cash pickup over any locations.',
  },
  withdraw: {
    title: 'Money Where You Need',
    subTitle: 'Simple cash pickup at thousands of locations worldwide',
    shortDescription:
      'Move your money where it matters. Save on international transfers in over 50 currencies, without hidden fees.',
    highlights: ['50+ currencies supported', 'No hidden transfer fees', 'Bank-grade secure delivery'],
    titleTwo: 'Trust + Confidence',
    subTitleTwo: 'Best ways to send money with Remitta',
    shortDescriptionTwo:
      'Send money easily to your favorite people. We work with you every step of the way to deliver your money securely.',
    playStoreUrl: '',
    appStoreUrl: '',
    items: [],
  },
  process: {
    sendMoneyTitle: 'Easy methods for sending over 120+ countries',
    receiveMoneyTitle: 'Easy methods for Receiving over 120+ countries',
    items: [],
  },
  testimonial: {
    title: 'What People Are Saying',
    subTitle: '4.5 Stars on Trustpilot Happy Customers',
    shortDescription: "Don't take our word for it — hear from our customers.",
    items: [],
  },
  cta: {
    title: 'Ready To Get Started?',
    subTitle: 'Get set up and save money on your next transfer',
    shortDescription:
      'Create your account in minutes and start sending money with transparent rates.',
    button: 'Register Now',
    buttonUrl: '/signup',
  },
  blog: {
    title: 'Official Blogs Remitta',
    subTitle: 'Beyond Borders: The Official Remitta Blog',
  },
  blogTwo: {
    title: 'Blog',
    subTitle: 'News and updates from Remitta',
  },
  countries: {
    title: 'Popular Country',
    subTitle: 'Most Popular Country',
    items: [],
  },
  footer: {
    shortDescription: 'Fast, secure international money transfers.',
    phone: '',
    address: '',
    email: '',
    items: [],
  },
  siteTheme: {
    primary: '#024ca7',
    primaryHover: '#023a85',
    primaryLight: '#0369d9',
    primarySoft: '#e8f1fc',
    accent: '#3d9b8f',
    accentSoft: '#e8f5f3',
    background: '#f8f6f2',
    surface: '#ffffff',
    text: '#1a1f2e',
    textMuted: '#5c6478',
    border: '#e8ecf2',
    peach: '#fce8e4',
    navbarRegisterBg: '#0f172a',
    navbarRegisterText: '#ffffff',
    navbarLoginBorder: '#0f172a',
    navbarLoginText: '#0f172a',
    footerBackground: '#ffffff',
  },
  tracking: {
    title: 'Track Your Transfer',
    subTitle: 'Enter your reference number to see transfer status',
    shortDescription: 'Track your remittance in real time with your reference or PIN.',
  },
  contact: {
    title: 'Contact Us',
    subTitle: 'We are here to help',
    shortDescription: 'Reach our support team for questions about transfers, KYC, or your account.',
    email: '',
    phone: '',
    address: '',
  },
  contactPage: {
    banner: {
      eyebrow: 'Get in touch',
      title: 'Contact',
      breadcrumbHome: 'Home',
      breadcrumbCurrent: 'Contact',
    },
    form: {
      title: 'Contact Us',
      subTitle: 'We are here to help',
      nameLabel: 'Your Name',
      namePlaceholder: 'John Doe',
      emailLabel: 'Your Email',
      emailPlaceholder: 'you@example.com',
      subjectLabel: 'Subject',
      subjectPlaceholder: 'How can we help?',
      messageLabel: 'Your Message',
      messagePlaceholder: 'Tell us more about your question...',
      newsletterText: 'Subscribe to our newsletter for product updates and rate alerts.',
      submitButton: 'Send Message',
      successMessage: 'Message sent successfully!',
    },
    supportCard: {
      heading: "We're here to help",
      description:
        'Our team responds quickly to questions about transfers, rates, and account support.',
    },
    contactInfo: {
      panelTitle: 'Reach us directly',
      items: [
        { fieldName: 'Send Email', fieldValue: 'example@gmail.com' },
        { fieldName: 'Call Us Now', fieldValue: '+880 123 (4567) 890' },
        { fieldName: 'Address', fieldValue: 'Uttara, Dhaka, Bangladesh' },
        { fieldName: 'Support', fieldValue: '24/7 customer assistance' },
      ],
    },
    faq: {
      title: 'Frequently asked questions',
      description: 'Quick answers about sending money, fees, and account support.',
      items: [
        {
          question: 'How long does a transfer take?',
          answer:
            'Delivery time depends on the destination and payout method. Many wallet and mobile money transfers arrive within minutes; bank transfers may take one to three business days.',
        },
        {
          question: 'What fees will I pay?',
          answer:
            'We show the exchange rate and transfer fee before you confirm payment. There are no hidden charges — the amount on the review screen is what you pay.',
        },
        {
          question: 'How do I track my transfer?',
          answer:
            'Use the Track Transfer page with your reference number or transaction ID from your confirmation email to see live status updates.',
        },
        {
          question: 'What documents do I need to send money?',
          answer:
            'Requirements vary by corridor and amount. Sign in to your account to complete verification; our team will guide you if additional documents are needed.',
        },
        {
          question: 'Can I cancel a transfer after sending?',
          answer:
            'If the transfer has not been paid out yet, contact support as soon as possible. Once funds are delivered to the recipient, cancellation may not be possible.',
        },
        {
          question: 'How do I contact customer support?',
          answer:
            'Use the form on this page, email us, or call the number listed under Reach us directly. Support is available 24/7 for urgent transfer issues.',
        },
      ],
    },
  },
  login: {
    title: 'Welcome back',
    subTitle: 'Sign in to continue sending money',
  },
  signup: {
    title: 'Create your account',
    subTitle: 'Join Remitta and start sending money securely',
  },
  aboutBanner: {
    title: 'About Remitta',
    subTitle: 'Trusted international money transfers',
    shortDescription: 'We help people send money home safely, quickly, and at fair rates.',
  },
  products: {
    title: 'Our Products',
    subTitle: 'Solutions built for you',
    items: [],
  },
  withdrawThree: {
    title: 'How It Works',
    subTitle: 'Send money in three simple steps',
    items: [],
  },
  customer: {
    title: 'Trusted by customers worldwide',
    subTitle: 'Millions of transfers delivered',
    items: [],
  },
  aboutTestimonials: {
    items: [
      {
        rating: 5,
        review:
          'Money was transferred promptly and securely. The whole experience was smooth from start to finish.',
        authorName: 'Mario Fleming',
        authorRole: 'VP of Communications',
        isHighlighted: true,
      },
      {
        rating: 5,
        review:
          'I had such a great experience sending money to Indonesia. Fast, clear fees, and excellent support.',
        authorName: 'Julia James',
        authorRole: 'Information Systems Director',
        isHighlighted: false,
      },
      {
        rating: 5,
        review: 'Nice and fast so convenient! Excellent service every time I send money home.',
        authorName: 'Dewey Stephens',
        authorRole: 'Marketing Specialist',
        isHighlighted: false,
      },
    ],
  },
  aboutTimeline: {
    title: "What we've done",
    subTitle: 'Empower your revenue team with our thought-leadership content.',
    items: [
      {
        year: '2015',
        milestones: ['Our founders launch the platform with a vision to simplify global money movement.'],
      },
      {
        year: '2016',
        milestones: ['Series A fundraising $15m', 'Reaches 100,000 personal customers'],
      },
      {
        year: '2017',
        milestones: [
          'Series B fundraising $66m',
          'Launches business accounts for small and medium enterprises',
        ],
      },
      {
        year: '2018',
        milestones: [
          'Granted banking licence in Lithuania',
          'Launches premium membership tier',
          'Series C fundraising raises $250m',
        ],
      },
      {
        year: '2019',
        milestones: [
          'First expansion into Australia and Singapore',
          'Launches trading and donations features',
          'Reaches 10 million customers',
        ],
      },
      {
        year: '2020',
        milestones: [
          'Launches in USA and Japan',
          'Launches banking services in Lithuania and Poland',
          'Series D fundraising raises $580m',
          'Reaches 14.5 million customers',
        ],
      },
      {
        year: '2021',
        milestones: [
          'Raised Series E funding of $800m to build the global financial superapp',
          'Launched Stays — book holidays directly from the app',
          'Launched On-Demand Pay for early access to earned wages',
        ],
      },
    ],
  },
  sendMoneyPage: {
    hero: {
      title: 'Fast and safe money transfers from {{senderCountry}}',
      description:
        'Move your money where it matters. Send from {{senderCountry}} in {{senderCurrency}} to {{receiverCountry}} — transparent rates and no hidden fees.',
      button: 'Create free account',
      buttonUrl: '/signup',
      getStartedButton: 'Get started',
      showAccountCta: true,
      appStoreRating: '4.8',
      appStoreReview: '1.4M reviews',
      playStoreRating: '4.8',
      playStoreReview: '1.2M reviews',
    },
    flow: {
      pageTitle: 'Send money',
      backButton: 'Back',
      continueButton: 'Continue',
      continueToPayment: 'Continue to payment',
      signInToContinue: 'Sign in to continue',
      steps: [
        { label: 'Amount', shortLabel: 'Amount' },
        { label: 'Recipient', shortLabel: 'Recipient' },
        { label: 'Review', shortLabel: 'Review' },
        { label: 'Payment methods', shortLabel: 'Payment' },
        { label: 'Pay', shortLabel: 'Pay' },
      ],
    },
    step1: {
      title: 'How much do you want to send?',
      description:
        "Enter the amount in USDT. We'll show the exchange rate and fees before you pay.",
    },
    step2: {
      title: 'Who are you sending to?',
      description: 'Enter recipient details for your selected delivery method.',
    },
    step3: {
      title: 'Review your transfer',
      description: 'Confirm amounts, recipient details, and fees before choosing how to pay.',
      headingSend: 'Send amount',
      headingRecipient: 'Recipient',
      headingFees: 'Exchange & fees',
    },
    step4: {
      title: 'Payment method',
      description:
        'Add or choose a card secured by Accept.blue. Your details are encrypted end-to-end.',
    },
    step5: {
      title: 'Confirm & pay',
      description: 'Review your transfer. Your card is charged securely via Accept.blue.',
      successTitle: 'Payment successful',
      holdTitle: 'Transfer under review',
      holdSubtitle:
        'Your transfer is being reviewed for compliance. You will be notified when it completes.',
      backHome: 'Back to home',
      sendAgain: 'Send again',
    },
    ways: {
      title: 'Ways to send money internationally',
      description:
        'The cost and speed of a money transfer depends on the receiving country, the receive method as well as how it is paid for. Currently, there are several receive methods available on our platform.',
      items: [
        {
          title: 'Airtime Top Up',
          shortDescription:
            'Top up credit for a pre-paid mobile phone number with no extra fees.',
          learnMoreText: 'Learn more',
          learnMoreUrl: '#',
        },
        {
          title: 'Bank Transfer',
          shortDescription:
            "Send money directly to a bank account. All you need are your receiver's details.",
          learnMoreText: 'Learn more',
          learnMoreUrl: '#',
        },
        {
          title: 'Mobile Money',
          shortDescription:
            "Instant transfer to your receiver's registered mobile money account number.",
          learnMoreText: 'Learn more',
          learnMoreUrl: '#',
        },
      ],
    },
    featureAbroad: {
      title: 'Moving and living abroad just got simpler',
      highlightWord: 'abroad',
      blocks: [
        {
          title: 'Receive your salary, pension, and more.',
          description:
            'Relocate without the stress — and without the multiple bank accounts. Share your details with your employer, pension scheme, family or friends, and get paid like a local.',
        },
        {
          title: 'Spend in local currency with your card.',
          description:
            'Avoid the bank appointments, and start spending as soon as you get there. With our debit card, you will always get the best possible exchange rate.',
        },
      ],
      button: 'Learn more',
      buttonUrl: '/signup',
    },
    featureReceive: {
      title: 'Receive money from around the world',
      highlightWord: 'money',
      blocks: [
        {
          title: 'Get paid like a local.',
          description:
            'UK account number, Euro IBAN, US routing number, and more. All in one account. Receive your salary, invoice payments, pension and profit from shares.',
        },
        {
          title: 'Work anywhere and link your account to Amazon, PayPal and more.',
          description:
            'Use your account details to receive and manage your earnings. Invoice like a local and manage your earnings from various online platforms and storefronts.',
        },
      ],
      button: 'Learn more',
      buttonUrl: '/signup',
    },
    localAccounts: {
      title: 'Get these local account details',
      description:
        "These are the account details you can share with others to receive money. Anyone can use these to pay you just like they'd pay a local.",
      items: [
        { currencyName: 'British pound', iso2: 'GB', details: 'UK sort code, Account number, and IBAN' },
        { currencyName: 'Euro', iso2: 'EU', details: 'Bank code (SWIFT/BIC) and IBAN' },
        { currencyName: 'US dollar', iso2: 'US', details: 'Routing number and Account number' },
        { currencyName: 'Australian dollar', iso2: 'AU', details: 'BSB code and Account number' },
        { currencyName: 'China Yuan', iso2: 'CN', details: 'Account number' },
        { currencyName: 'Singapore dollar', iso2: 'SG', details: 'Bank code, Bank name, and Account number' },
        { currencyName: 'Canadian dollar', iso2: 'CA', details: 'Institution number, Transit number, and Account number' },
        { currencyName: 'Hungarian forint', iso2: 'HU', details: 'Account number' },
        { currencyName: 'Turkish lira', iso2: 'TR', details: 'Bank name and IBAN' },
      ],
    },
    reviews: {
      title: 'OneZaPay Money Transfer Review',
      description:
        'Join the thousands who recommend OneZaPay for international transfers. Fast, transparent fees, and support when you need it.',
      items: [
        {
          quote:
            'I have been using this service for four years. It is the most trustful, fastest, easiest to use and cheapest service to transfer money. I am very satisfied with the service which informs me on every step.',
          authorName: 'Minerva Silute',
          authorRole: 'Senior Finance Manager at Finantioer',
        },
        {
          quote:
            'Sending money abroad has never been easier. Clear fees, great rates, and my family receives funds within minutes.',
          authorName: 'James Okonkwo',
          authorRole: 'Small business owner',
        },
        {
          quote:
            'Excellent customer support and a smooth app experience every time I send money home.',
          authorName: 'Sarah Chen',
          authorRole: 'Software engineer',
        },
      ],
    },
  },
  aboutMission: {
    title: 'Our mission: to simplify all things money',
    paragraphs: [
      'Money matters are complicated. Whether it is sending money abroad, balancing your family budget, or scaling your business — we have all experienced how fractured and frustrating finances can be.',
      'That is why we are here. We exist to remove the friction that stands in the way of your money goals becoming your new reality.',
      'We are building a platform so effortless, so seamless, so borderless that you will never want to use another financial service again.',
      'Our goal is for everyone to manage spending, saving, investing, borrowing, and more in just a few taps.',
    ],
    buttonText: 'Meet our Leadership team',
    buttonUrl: '/contact',
    collageSlots: 8,
  },
  amlHome: {
    brandName: 'Remitta',
    logoUrl: '',
    pageTitle: 'AML Compliance — Remitta',
    msb: {
      eyebrow: 'US REGULATOR COMPLIANCE NOTICE',
      heading: '{brand} operates under full US-regulator compliance.',
      paragraph:
        '{brand} is a Money Services Business registered with FinCEN. Our AML programme adheres to BSA and USA PATRIOT Act requirements.',
      badges: ['FinCEN MSB Registered', 'BSA · 31 CFR Chapter X', 'USA PATRIOT Act §326'],
    },
    hero: {
      pill: 'BSA / FinCEN AML Programme',
      title: 'AML compliance at {brand}.',
      lead: '{brand} is a regulated payment provider with customer screening and transaction monitoring.',
      metaChips: [],
    },
  },
};

/**
 * Seeds missing CMS sections so GET /api/manage-content/:sectionType does not 404 on fresh DBs.
 */
export async function ensureDefaultManageContent() {
  let created = 0;
  try {
    for (const [sectionType, englishData] of Object.entries(DEFAULT_MANAGE_CONTENT)) {
      const existing = await prisma.manageContent.findFirst({
        where: { sectionType },
        select: { id: true },
      });
      if (existing) continue;

      await prisma.manageContent.create({
        data: {
          sectionType,
          englishData,
          spanishData: null,
          images: null,
        },
      });
      created += 1;
    }
    if (created > 0) {
      console.log(`✅ Seeded ${created} default manage-content section(s)`);
    }

    const sendMoneyRow = await prisma.manageContent.findFirst({
      where: { sectionType: 'sendMoneyPage' },
      select: { id: true, englishData: true },
    });
    if (
      sendMoneyRow?.englishData &&
      (!sendMoneyRow.englishData.ways || !sendMoneyRow.englishData.localAccounts)
    ) {
      await prisma.manageContent.update({
        where: { id: sendMoneyRow.id },
        data: {
          englishData: {
            ...DEFAULT_MANAGE_CONTENT.sendMoneyPage,
            ...sendMoneyRow.englishData,
          },
        },
      });
      console.log('✅ Merged full sendMoneyPage defaults into existing CMS row');
    }

    const contactPageRow = await prisma.manageContent.findFirst({
      where: { sectionType: 'contactPage' },
      select: { id: true, englishData: true },
    });
    if (!contactPageRow) {
      await prisma.manageContent.create({
        data: {
          sectionType: 'contactPage',
          englishData: DEFAULT_MANAGE_CONTENT.contactPage,
          spanishData: null,
          images: null,
        },
      });
      console.log('✅ Seeded contactPage CMS section');
    } else if (contactPageRow.englishData && !contactPageRow.englishData.faq) {
      await prisma.manageContent.update({
        where: { id: contactPageRow.id },
        data: {
          englishData: {
            ...DEFAULT_MANAGE_CONTENT.contactPage,
            ...contactPageRow.englishData,
          },
        },
      });
      console.log('✅ Merged full contactPage defaults (incl. FAQ) into existing CMS row');
    }

    const { sanitizeAboutTimelineEnglishData } = await import('./sanitizeAboutTimeline.js');
    const timelineRow = await prisma.manageContent.findFirst({
      where: { sectionType: 'aboutTimeline' },
      select: { id: true, englishData: true },
    });
    if (timelineRow?.englishData?.items?.length) {
      const sanitized = sanitizeAboutTimelineEnglishData(timelineRow.englishData);
      const before = JSON.stringify(timelineRow.englishData.items);
      const after = JSON.stringify(sanitized.items);
      if (before !== after) {
        await prisma.manageContent.update({
          where: { id: timelineRow.id },
          data: { englishData: sanitized },
        });
        console.log('✅ Sanitized aboutTimeline CMS items (removed invalid/duplicate years)');
      }
    }

    return created;
  } catch (err) {
    console.warn('[CMS] ensureDefaultManageContent failed:', err?.message || err);
    return 0;
  }
}
