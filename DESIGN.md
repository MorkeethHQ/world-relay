# FAVOUR design

Scope: image-led FAVOUR front door and shared navigation. Retain the World Mini Apps UI Kit components and image-led cards.

Font: one native system sans stack, defined by `--favour-font`. Apple uses San Francisco; other devices use Segoe UI or Roboto with sans fallbacks. No Aeonik, locally installed display font, mono heading, or remote font is required. Kit text and controls inherit the same stack.

Type sizes (design choices in CSS pixels): wordmark 18 bold; campaign section 24 bold; card title 28 bold; body and buttons 15; supporting copy 14; metadata 12; navigation 11 semibold. Body line height 1.4 to 1.5, titles 1.12 to 1.2. Keep the ruled pitch readable as supporting text without introducing another font.

Colours (existing front-door values): ink #191c20, white #ffffff, canvas #fafafa, muted #62666d, border #e5e7eb. Use ink for primary actions and white text on dark buttons. Navigation uses ink for active and muted ink for inactive. Photography supplies expressive colour; retain its dark overlay for legibility. Amber remains a semantic points indicator, not a decorative accent. Do not add new accent colours.

Landing: show the ruled pitch in both populated and empty states. No onboarding progress marker on the landing page. Progress markers appear only once onboarding begins. Keep image cards, existing actions, and bottom navigation.

Verification: inspect the phone viewport at 390 CSS pixels wide (brief requirement), including landing, card actions, and navigation. Check that the font stays stable after loading and that no horizontal overflow appears. The suspected switch is the landing progress pill; visual checker must confirm this interpretation.
