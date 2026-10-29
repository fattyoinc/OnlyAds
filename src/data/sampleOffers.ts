/**
 * SIMULATED DATA. Every brand, price and promo code below is fictional and
 * exists only to demo the product. Timestamps are generated relative to "now"
 * so the demo never goes stale; local offers are positioned relative to an
 * anchor point (the user's location if they share it, otherwise a default).
 */
import type { CategoryId, GeoPoint, Offer, OfferKind } from '@/types/offer';
import { DEFAULT_ANCHOR } from './defaults';

export { DEFAULT_ANCHOR };

interface Seed {
  id: string;
  cat: CategoryId;
  kind?: OfferKind;
  title: string;
  sub?: string;
  desc: string;
  brand: string;
  price?: number;
  was?: number;
  promo?: string;
  code?: string;
  /** Hours until expiry. */
  ends?: number;
  cta?: string;
  tags: string[];
  icon: string;
  colors: [string, string];
  /** Offset from anchor in km [north, east] + place info. */
  near?: [number, number, string, string];
  sponsored?: boolean;
  affiliate?: boolean;
  rating?: number;
  /** Hours since created (freshness). */
  age?: number;
}

const SEEDS: Seed[] = [
  // ---------- Food ----------
  { id: 'f1', cat: 'food', kind: 'local', title: '2-for-1 Wood-Fired Pizzas', sub: 'Tonight only, dine-in or pickup', desc: 'Order any large wood-fired pizza and get a second one free. Valid on all classic and specialty pies, 4pm–10pm.', brand: 'Forno Nove', promo: '2 for 1', ends: 6, cta: 'Get directions', tags: ['pizza', 'italian', 'dinner', 'bogo'], icon: 'pizza', colors: ['#D7263D', '#F46036'], near: [0.6, 0.4, '214 Collins Ave', 'Forno Nove'], rating: 4.7, age: 3 },
  { id: 'f2', cat: 'food', kind: 'local', title: '$5 Smash Burger Lunch', sub: 'Weekdays 11am–2pm', desc: 'Double smash burger with house sauce and pickles for $5. Add fries and a drink for $3 more.', brand: 'Smashville', price: 5, was: 11, ends: 52, cta: 'Get directions', tags: ['burger', 'lunch', 'cheap eats'], icon: 'hamburger', colors: ['#F2994A', '#F2C94C'], near: [-1.2, 0.8, '88 SW 8th St', 'Smashville'], rating: 4.5, age: 20 },
  { id: 'f3', cat: 'food', kind: 'deal', title: '40% Off Your First 3 Delivery Orders', sub: 'Any restaurant on the app', desc: 'New customers save 40% (up to $15 each) on their first three delivery orders. Minimum order $20.', brand: 'Dashly', promo: '40% off', code: 'ONLYADS40', ends: 24 * 9, cta: 'Claim offer', tags: ['delivery', 'new customer', 'dinner'], icon: 'moped', colors: ['#EB3349', '#F45C43'], sponsored: true, age: 30 },
  { id: 'f4', cat: 'food', kind: 'local', title: 'Happy Hour: Tacos $2, Margaritas $6', sub: 'Mon–Fri 3pm–6pm', desc: 'Street tacos for $2 each and classic margaritas for $6 during happy hour at the bar and patio.', brand: 'Casa Lumbre', promo: 'Happy hour', ends: 30, cta: 'Get directions', tags: ['tacos', 'mexican', 'drinks', 'happy hour'], icon: 'taco', colors: ['#11998E', '#F7B733'], near: [2.1, -0.5, '1400 Brickell Ave', 'Casa Lumbre'], rating: 4.6, age: 8 },
  { id: 'f5', cat: 'food', kind: 'local', title: 'Free Pastry With Any Latte', sub: 'Before 10am', desc: 'Start your morning right: pick any croissant or muffin free with a latte, cappuccino or flat white.', brand: 'Morning Ritual Coffee', promo: 'Free pastry', ends: 20, cta: 'Get directions', tags: ['coffee', 'breakfast', 'bakery'], icon: 'coffee', colors: ['#6F4E37', '#C69C6D'], near: [0.3, -0.9, '35 NE 2nd Ave', 'Morning Ritual'], rating: 4.8, age: 2 },
  { id: 'f6', cat: 'food', kind: 'local', title: 'Omakase for Two — $89', sub: '12-course chef’s tasting', desc: 'Our seasonal 12-course omakase for two guests, normally $140. Reservations required; limited seats each night.', brand: 'Kaiyo Sushi Bar', price: 89, was: 140, ends: 24 * 5, cta: 'Reserve', tags: ['sushi', 'japanese', 'date night'], icon: 'fish', colors: ['#141E30', '#243B55'], near: [3.4, 1.1, '900 Biscayne Blvd', 'Kaiyo'], rating: 4.9, age: 40, sponsored: true },
  { id: 'f7', cat: 'food', kind: 'deal', title: 'Meal Kits: 16 Free Meals', sub: 'Spread across your first 5 boxes', desc: 'Chef-designed recipes with pre-portioned ingredients delivered weekly. Skip or cancel anytime.', brand: 'Plated Week', promo: '16 free meals', code: 'FRESH16', ends: 24 * 14, cta: 'Claim offer', tags: ['meal kit', 'cooking', 'subscription'], icon: 'chef-hat', colors: ['#56AB2F', '#A8E063'], affiliate: true, age: 70 },

  // ---------- Fashion ----------
  { id: 'a1', cat: 'fashion', title: 'Linen Overshirt', sub: 'End-of-season sale', desc: 'Breathable European linen overshirt with a relaxed fit. Available in sand, olive and navy.', brand: 'Northwell & Co.', price: 49, was: 98, ends: 24 * 3, cta: 'Shop now', tags: ['shirt', 'linen', 'menswear', 'sale'], icon: 'tshirt-crew-outline', colors: ['#C9B79C', '#8A7650'], affiliate: true, rating: 4.4, age: 12 },
  { id: 'a2', cat: 'fashion', title: 'Everything 30% Off', sub: 'Sitewide, including new arrivals', desc: 'Take 30% off everything sitewide for 48 hours. Free returns within 30 days.', brand: 'Atelier Mira', promo: '30% off sitewide', code: 'MIRA30', ends: 40, cta: 'Shop the sale', tags: ['womenswear', 'sitewide', 'dresses'], icon: 'hanger', colors: ['#8E2DE2', '#F15BB5'], sponsored: true, age: 5 },
  { id: 'a3', cat: 'fashion', title: 'Recycled Wool Puffer', sub: 'New for winter', desc: 'Lightweight warmth from recycled insulation with a water-resistant shell. Packs into its own pocket.', brand: 'Fjell Outdoor', price: 179, was: 229, ends: 24 * 10, cta: 'Shop now', tags: ['jacket', 'outerwear', 'winter', 'sustainable'], icon: 'coat-rack', colors: ['#283E51', '#4B79A1'], affiliate: true, rating: 4.7, age: 50 },
  { id: 'a4', cat: 'fashion', title: 'Gold Vermeil Hoops', sub: 'Buy 2, get 1 free', desc: 'Hypoallergenic 18k gold vermeil hoops, handmade. Mix and match any three pieces.', brand: 'Lune Jewelry', price: 65, promo: 'Buy 2 get 1', ends: 24 * 6, cta: 'Shop now', tags: ['jewelry', 'earrings', 'gift'], icon: 'diamond-stone', colors: ['#B8860B', '#F3D98B'], rating: 4.8, age: 26 },
  { id: 'a5', cat: 'fashion', title: 'Leather Weekender Bag', desc: 'Full-grain leather weekender with a separate shoe compartment. Ages beautifully.', brand: 'Harlow Goods', price: 245, was: 320, ends: 24 * 12, cta: 'Shop now', tags: ['bag', 'leather', 'travel', 'gift'], icon: 'bag-personal-outline', colors: ['#5D4037', '#A1887F'], affiliate: true, rating: 4.6, age: 90 },

  // ---------- Sneakers ----------
  { id: 's1', cat: 'sneakers', title: 'Aero Runner 3 — Restock', sub: 'All colorways back in stock', desc: 'Our lightest daily trainer with responsive foam and a breathable knit upper. Restocked in all sizes.', brand: 'Stride Lab', price: 129, ends: 24 * 4, cta: 'Shop now', tags: ['running', 'trainers', 'restock'], icon: 'shoe-sneaker', colors: ['#0F2027', '#2C5364'], sponsored: true, rating: 4.7, age: 4 },
  { id: 's2', cat: 'sneakers', title: 'Court Classic Low — 35% Off', sub: 'White leather', desc: 'The timeless court sneaker in full-grain leather with a cushioned insole.', brand: 'Volley Club', price: 58, was: 90, ends: 30, cta: 'Shop now', tags: ['lifestyle', 'leather', 'white sneakers', 'sale'], icon: 'shoe-sneaker', colors: ['#E0EAFC', '#94A3B8'], affiliate: true, rating: 4.5, age: 15 },
  { id: 's3', cat: 'sneakers', title: 'Trail Pro GTX', sub: 'Waterproof trail runner', desc: 'Grippy lugs, a rock plate and a waterproof membrane for muddy miles.', brand: 'Ridgeline', price: 149, was: 175, ends: 24 * 8, cta: 'Shop now', tags: ['trail', 'running', 'waterproof', 'hiking'], icon: 'hiking', colors: ['#3E5151', '#DECBA4'], affiliate: true, rating: 4.6, age: 60 },
  { id: 's4', cat: 'sneakers', title: 'Limited Drop: “Sunset” Hi-Tops', sub: 'Releases Friday 10am', desc: 'Numbered limited edition run of 500 pairs. Enter the raffle for a chance to purchase.', brand: 'Kicks Collective', price: 210, promo: 'Raffle open', ends: 60, cta: 'Enter raffle', tags: ['limited', 'drop', 'hi-top', 'raffle'], icon: 'shoe-sneaker', colors: ['#FF512F', '#DD2476'], sponsored: true, age: 1 },
  { id: 's5', cat: 'sneakers', kind: 'local', title: 'Trade-In: $30 Off New Runners', sub: 'Bring any old pair', desc: 'Bring in any pair of used running shoes for recycling and take $30 off a new pair in store.', brand: 'Pace Running Store', promo: '$30 trade-in', ends: 24 * 7, cta: 'Get directions', tags: ['running', 'trade-in', 'store'], icon: 'recycle', colors: ['#134E5E', '#71B280'], near: [-2.5, -1.4, '2100 Coral Way', 'Pace Running'], rating: 4.9, age: 33 },

  // ---------- Tech ----------
  { id: 't1', cat: 'tech', title: 'Noise-Cancelling Headphones', sub: '40-hour battery', desc: 'Adaptive noise cancelling, spatial audio and 40 hours of playback. Includes travel case.', brand: 'Sonora Audio', price: 199, was: 299, ends: 24 * 2, cta: 'Shop now', tags: ['headphones', 'audio', 'anc', 'gift'], icon: 'headphones', colors: ['#232526', '#414345'], sponsored: true, rating: 4.7, age: 6 },
  { id: 't2', cat: 'tech', title: 'Smart Home Starter Kit', sub: 'Hub + 4 bulbs + 2 plugs', desc: 'Control lights and plugs from your phone or by voice. Works with all major voice assistants.', brand: 'Lumen Home', price: 89, was: 139, ends: 24 * 5, cta: 'Shop now', tags: ['smart home', 'lighting', 'bundle'], icon: 'home-automation', colors: ['#2B5876', '#4E4376'], affiliate: true, rating: 4.3, age: 45 },
  { id: 't3', cat: 'tech', title: '14" Ultrabook — Student Pricing', sub: 'Save up to $250', desc: 'All-day battery, OLED display and 16GB RAM. Verified students save up to $250.', brand: 'Arcbook', price: 899, was: 1149, ends: 24 * 20, cta: 'Verify & shop', tags: ['laptop', 'student', 'computer'], icon: 'laptop', colors: ['#373B44', '#4286F4'], affiliate: true, rating: 4.5, age: 100 },
  { id: 't4', cat: 'tech', title: 'Fitness Smartwatch', sub: 'GPS + heart rate + sleep', desc: 'Track workouts, sleep and recovery. 10-day battery and water resistant to 50m.', brand: 'Pulsewear', price: 149, was: 199, ends: 24 * 4, cta: 'Shop now', tags: ['smartwatch', 'wearable', 'fitness', 'gift'], icon: 'watch-variant', colors: ['#0F0C29', '#302B63'], rating: 4.4, age: 18 },
  { id: 't5', cat: 'tech', kind: 'service', title: 'Unlimited 5G — $25/mo', sub: 'First 6 months', desc: 'Unlimited talk, text and 5G data for $25/month for six months, then $45/month. Bring your own phone.', brand: 'Orbit Mobile', promo: '$25/mo', ends: 24 * 15, cta: 'Switch now', tags: ['phone plan', 'mobile', '5g'], icon: 'signal-5g', colors: ['#4776E6', '#8E54E9'], sponsored: true, age: 80 },
  { id: 't6', cat: 'tech', title: 'Instant Print Camera', sub: 'Bundle with 20 prints', desc: 'Point, shoot and print in seconds. Bundle includes 20 sheets of film and a case.', brand: 'Snapbox', price: 79, was: 109, ends: 24 * 9, cta: 'Shop now', tags: ['camera', 'photo', 'gift'], icon: 'camera-outline', colors: ['#F857A6', '#FF5858'], affiliate: true, rating: 4.6, age: 36 },

  // ---------- Home ----------
  { id: 'h1', cat: 'home', title: 'Modular Sofa — Up to 25% Off', sub: 'Free white-glove delivery', desc: 'Configure your perfect sofa from washable, pet-friendly modules. Ships in 2 weeks.', brand: 'Sundays Living', promo: 'Up to 25% off', ends: 24 * 6, cta: 'Shop now', tags: ['sofa', 'furniture', 'living room'], icon: 'sofa-outline', colors: ['#B79891', '#94716B'], sponsored: true, age: 22 },
  { id: 'h2', cat: 'home', title: 'Cast Iron Dutch Oven', sub: '5.5 qt, enameled', desc: 'Even heat for braises, bread and soups. Lifetime warranty.', brand: 'Hearth & Iron', price: 89, was: 150, ends: 24 * 3, cta: 'Shop now', tags: ['kitchen', 'cookware', 'gift'], icon: 'pot-steam-outline', colors: ['#C0392B', '#8E2A21'], affiliate: true, rating: 4.9, age: 9 },
  { id: 'h3', cat: 'home', title: 'Organic Sateen Sheet Set', desc: 'Silky GOTS-certified organic cotton sheets. 100-night trial.', brand: 'Driftbed', price: 119, was: 169, ends: 24 * 11, cta: 'Shop now', tags: ['bedding', 'sheets', 'organic'], icon: 'bed-outline', colors: ['#D3CCE3', '#E9E4F0'], affiliate: true, rating: 4.6, age: 72 },
  { id: 'h4', cat: 'home', kind: 'service', title: 'Home Cleaning — $50 Off', sub: 'First deep clean', desc: 'Background-checked, insured cleaners. Book in 60 seconds, satisfaction guaranteed.', brand: 'Tidy Crew', promo: '$50 off', code: 'TIDY50', ends: 24 * 10, cta: 'Book now', tags: ['cleaning', 'services', 'home'], icon: 'broom', colors: ['#4CA1AF', '#C4E0E5'], age: 55 },
  { id: 'h5', cat: 'home', title: 'Robot Vacuum + Mop', sub: 'Self-emptying base', desc: 'LiDAR mapping, mopping pad and a base that empties itself for 60 days.', brand: 'Swiftbot', price: 349, was: 549, ends: 28, cta: 'Shop now', tags: ['vacuum', 'smart home', 'cleaning'], icon: 'robot-vacuum', colors: ['#3A6073', '#16222A'], sponsored: true, rating: 4.4, age: 7 },

  // ---------- Beauty ----------
  { id: 'b1', cat: 'beauty', title: 'Vitamin C Glow Serum', sub: 'Free mini with purchase', desc: '15% vitamin C with ferulic acid for brighter, even-toned skin. Fragrance-free.', brand: 'Dew Theory', price: 38, promo: 'Free mini', ends: 24 * 4, cta: 'Shop now', tags: ['skincare', 'serum', 'vitamin c'], icon: 'water-outline', colors: ['#F7971E', '#FFD200'], sponsored: true, rating: 4.6, age: 14 },
  { id: 'b2', cat: 'beauty', title: 'Holiday Fragrance Discovery Set', sub: '8 minis + full-size voucher', desc: 'Try 8 signature scents, then redeem the included voucher for a full-size bottle of your favorite.', brand: 'Maison Ether', price: 35, ends: 24 * 18, cta: 'Shop now', tags: ['fragrance', 'perfume', 'gift', 'holiday'], icon: 'spray', colors: ['#EE9CA7', '#C86DD7'], affiliate: true, rating: 4.8, age: 48 },
  { id: 'b3', cat: 'beauty', kind: 'local', title: 'Gel Manicure — $25', sub: 'Weekdays before 3pm', desc: 'Long-lasting gel manicure with cuticle care. Walk-ins welcome.', brand: 'Polished Studio', price: 25, was: 45, ends: 24 * 5, cta: 'Book now', tags: ['nails', 'manicure', 'salon'], icon: 'hand-back-right-outline', colors: ['#FF9A9E', '#FAD0C4'], near: [1.4, 1.9, '450 Lincoln Rd', 'Polished Studio'], rating: 4.7, age: 29 },
  { id: 'b4', cat: 'beauty', title: '3 Lipsticks for $30', desc: 'Mix and match any three satin or matte lipsticks. 24 shades.', brand: 'Rouge Republic', promo: '3 for $30', ends: 50, cta: 'Shop now', tags: ['makeup', 'lipstick', 'bundle'], icon: 'lipstick', colors: ['#B91D73', '#F953C6'], rating: 4.3, age: 11 },

  // ---------- Travel ----------
  { id: 'v1', cat: 'travel', kind: 'experience', title: 'Cancún All-Inclusive — 4 Nights', sub: 'Flights + hotel from $899', desc: 'Beachfront resort, unlimited dining and drinks, round-trip flights included. Select December dates.', brand: 'Sunward Trips', price: 899, was: 1299, ends: 24 * 3, cta: 'See dates', tags: ['beach', 'all inclusive', 'vacation', 'mexico'], icon: 'beach', colors: ['#1488CC', '#2B32B2'], sponsored: true, rating: 4.5, age: 10 },
  { id: 'v2', cat: 'travel', kind: 'deal', title: 'Flash Fare: Coast-to-Coast $119', sub: 'One way, travel Jan–Feb', desc: 'Nonstop fares from $119 one way between select East and West Coast cities. Book within 48 hours.', brand: 'Skyline Air', price: 119, was: 249, ends: 34, cta: 'Find flights', tags: ['flights', 'airfare', 'winter'], icon: 'airplane', colors: ['#00B4DB', '#0083B0'], affiliate: true, age: 3 },
  { id: 'v3', cat: 'travel', kind: 'experience', title: 'Mountain Cabin Weekend', sub: '3rd night free', desc: 'Cozy cabins with hot tubs and fireplaces. Stay 3 nights, pay for 2.', brand: 'Pinehaven Stays', promo: '3rd night free', ends: 24 * 12, cta: 'Book stay', tags: ['cabin', 'weekend', 'getaway', 'mountains'], icon: 'pine-tree', colors: ['#2C3E50', '#4CA1AF'], affiliate: true, rating: 4.8, age: 65 },
  { id: 'v4', cat: 'travel', title: 'Carry-On Spinner Luggage', desc: 'Polycarbonate shell, compression system and lifetime warranty.', brand: 'Roam Supply', price: 175, was: 245, ends: 24 * 7, cta: 'Shop now', tags: ['luggage', 'travel gear', 'gift'], icon: 'bag-suitcase-outline', colors: ['#536976', '#292E49'], rating: 4.7, age: 88 },
  { id: 'v5', cat: 'travel', kind: 'local', title: 'Sunset Catamaran Cruise', sub: '25% off weekday sailings', desc: 'Two-hour sunset sail with drinks and music around the bay.', brand: 'Bay Breeze Charters', price: 59, was: 79, ends: 24 * 6, cta: 'Book now', tags: ['boat', 'sunset', 'experience', 'date night'], icon: 'sail-boat', colors: ['#FF7E5F', '#FEB47B'], near: [1.8, 3.2, 'Bayside Marina', 'Bay Breeze'], rating: 4.9, age: 19 },

  // ---------- Fitness ----------
  { id: 'x1', cat: 'fitness', kind: 'local', title: 'First Month $19 + No Joining Fee', sub: 'All classes included', desc: 'Unlimited HIIT, cycling and strength classes for your first month. No contract.', brand: 'Forge Fitness', price: 19, was: 89, ends: 24 * 8, cta: 'Claim pass', tags: ['gym', 'classes', 'hiit'], icon: 'dumbbell', colors: ['#11998E', '#38EF7D'], near: [-0.8, 1.5, '701 Brickell Key', 'Forge Fitness'], sponsored: true, rating: 4.6, age: 16 },
  { id: 'x2', cat: 'fitness', title: 'Adjustable Dumbbells (5–52 lb)', desc: 'Replace 15 sets of weights with one compact pair. Dial-select in seconds.', brand: 'IronDial', price: 299, was: 429, ends: 24 * 5, cta: 'Shop now', tags: ['home gym', 'weights', 'strength'], icon: 'weight-lifter', colors: ['#232526', '#E52D27'], affiliate: true, rating: 4.7, age: 42 },
  { id: 'x3', cat: 'fitness', kind: 'local', title: 'Yoga: 3 Classes for $30', sub: 'New students', desc: 'Hot, vinyasa or restorative — try any three classes within 30 days.', brand: 'Still Water Yoga', price: 30, was: 66, ends: 24 * 9, cta: 'Claim pass', tags: ['yoga', 'wellness', 'classes'], icon: 'meditation', colors: ['#DA4453', '#89216B'], near: [2.6, -1.8, '320 Miracle Mile', 'Still Water'], rating: 4.9, age: 58 },
  { id: 'x4', cat: 'fitness', title: 'Protein Variety Pack', sub: 'Subscribe & save 20%', desc: '30 servings, 6 flavors, 25g protein each. Grass-fed whey isolate.', brand: 'Clean Fuel', price: 44, was: 55, ends: 24 * 14, cta: 'Shop now', tags: ['nutrition', 'protein', 'supplements'], icon: 'cup-outline', colors: ['#614385', '#516395'], age: 95 },

  // ---------- Gifts ----------
  { id: 'g1', cat: 'gifts', title: 'Gifts Under $25', sub: 'Curated holiday picks', desc: '50+ thoughtful gifts under $25: candles, games, gadgets and treats. Free gift wrap.', brand: 'The Gift Edit', promo: 'Under $25', ends: 24 * 30, cta: 'Browse gifts', tags: ['gift', 'holiday', 'christmas', 'stocking stuffers'], icon: 'gift-outline', colors: ['#C31432', '#F0A500'], sponsored: true, age: 6 },
  { id: 'g2', cat: 'gifts', title: 'Personalized Star Map Print', sub: 'The night sky on any date', desc: 'A custom print of the stars on a date and place that matters. Framed or digital.', brand: 'Starlit Prints', price: 39, was: 59, ends: 24 * 21, cta: 'Personalize', tags: ['gift', 'personalized', 'anniversary', 'christmas'], icon: 'star-shooting-outline', colors: ['#0F2027', '#203A43'], affiliate: true, rating: 4.8, age: 77 },
  { id: 'g3', cat: 'gifts', title: 'Artisan Chocolate Advent Calendar', desc: '24 single-origin chocolates, one for every day until Christmas.', brand: 'Cacao Lane', price: 45, ends: 24 * 25, cta: 'Shop now', tags: ['gift', 'christmas', 'chocolate', 'advent'], icon: 'calendar-star', colors: ['#3E2723', '#BF360C'], affiliate: true, rating: 4.9, age: 5 },
  { id: 'g4', cat: 'gifts', kind: 'experience', title: 'Gift an Experience', sub: 'Cooking classes, spa days & more', desc: 'Over 2,000 experiences nationwide. Recipient picks the date. Delivered by email instantly.', brand: 'Moments Box', promo: '15% off', code: 'MOMENTS15', ends: 24 * 16, cta: 'Browse experiences', tags: ['gift', 'experience', 'last minute'], icon: 'party-popper', colors: ['#FC466B', '#3F5EFB'], age: 39 },
  { id: 'g5', cat: 'gifts', title: 'Gifts for Coffee Lovers', sub: 'Grinder + beans bundle', desc: 'Burr grinder and two bags of specialty single-origin beans, gift boxed.', brand: 'Grind & Bloom', price: 69, was: 95, ends: 24 * 12, cta: 'Shop now', tags: ['gift', 'coffee', 'bundle'], icon: 'coffee-maker-outline', colors: ['#6F4E37', '#C69C6D'], rating: 4.6, age: 61 },

  // ---------- Entertainment ----------
  { id: 'e1', cat: 'entertainment', kind: 'service', title: '3 Months of Streaming for $1', sub: 'New & returning members', desc: 'Thousands of films and original series, ad-free. $1 for 3 months, then $9.99/month.', brand: 'Reelhouse', price: 1, promo: '$1 for 3 months', ends: 24 * 7, cta: 'Start watching', tags: ['streaming', 'movies', 'tv'], icon: 'play-circle-outline', colors: ['#141E30', '#7F00FF'], sponsored: true, age: 13 },
  { id: 'e2', cat: 'entertainment', kind: 'local', title: 'Concert Tickets — 2 for $50', sub: 'Saturday at The Grove Amphitheater', desc: 'Two general-admission lawn tickets for Saturday’s indie double bill.', brand: 'Grove Amphitheater', price: 50, was: 90, ends: 26, cta: 'Get tickets', tags: ['concert', 'music', 'live', 'weekend'], icon: 'music', colors: ['#DA22FF', '#9733EE'], near: [4.2, -2.4, '3400 Grand Ave', 'Grove Amphitheater'], age: 4 },
  { id: 'e3', cat: 'entertainment', title: 'Cozy Mystery Board Game', sub: 'Game night favorite', desc: 'Cooperative deduction game for 2–6 players. 45 minutes per game.', brand: 'Meeple Works', price: 29, was: 40, ends: 24 * 6, cta: 'Shop now', tags: ['board game', 'gift', 'family'], icon: 'dice-multiple-outline', colors: ['#16A085', '#F4D03F'], affiliate: true, rating: 4.7, age: 47 },
  { id: 'e4', cat: 'entertainment', kind: 'local', title: 'Bowling + Arcade Night — $15', sub: 'Sun–Thu after 8pm', desc: 'Two games of bowling, shoe rental and $10 arcade card per person.', brand: 'Strike City', price: 15, was: 32, ends: 24 * 4, cta: 'Get directions', tags: ['bowling', 'arcade', 'night out'], icon: 'bowling', colors: ['#F80759', '#BC4E9C'], near: [-3.1, 2.2, '5800 Sunset Dr', 'Strike City'], rating: 4.3, age: 25 },

  // ---------- Grocery ----------
  { id: 'r1', cat: 'grocery', kind: 'local', title: 'Weekly Specials: Produce 30% Off', sub: 'Through Sunday', desc: 'Seasonal fruits and vegetables 30% off, plus buy-one-get-one on select pantry staples.', brand: 'Green Basket Market', promo: '30% off produce', ends: 24 * 4, cta: 'View circular', tags: ['groceries', 'produce', 'weekly ad'], icon: 'basket-outline', colors: ['#56AB2F', '#A8E063'], near: [-0.4, -1.1, '1200 SW 1st Ave', 'Green Basket'], age: 18 },
  { id: 'r2', cat: 'grocery', kind: 'service', title: 'Free Grocery Delivery for a Month', sub: 'Orders over $35', desc: 'Same-day delivery from local stores with no delivery fees for 30 days.', brand: 'Cartwheel', promo: 'Free delivery', ends: 24 * 10, cta: 'Start trial', tags: ['grocery delivery', 'subscription'], icon: 'cart-outline', colors: ['#43C6AC', '#191654'], sponsored: true, age: 52 },
  { id: 'r3', cat: 'grocery', title: 'Organic Snack Box', sub: '20 snacks, curated monthly', desc: 'Clean-label snacks from small brands, delivered monthly. First box half off.', brand: 'Nibble Crate', price: 17, was: 34, ends: 24 * 13, cta: 'Shop now', tags: ['snacks', 'organic', 'subscription'], icon: 'food-apple-outline', colors: ['#FF8008', '#FFC837'], affiliate: true, age: 84 },

  // ---------- Kids ----------
  { id: 'k1', cat: 'kids', title: 'STEM Robot Building Kit', sub: 'Ages 8+', desc: 'Build and code 5 robots with a drag-and-drop app. Holiday bestseller.', brand: 'Bright Bots', price: 59, was: 79, ends: 24 * 9, cta: 'Shop now', tags: ['toys', 'stem', 'gift', 'christmas'], icon: 'robot-outline', colors: ['#F7971E', '#FFD200'], affiliate: true, rating: 4.8, age: 21 },
  { id: 'k2', cat: 'kids', title: 'Kids’ Winter Gear — 40% Off', sub: 'Coats, boots & mittens', desc: 'Warm, durable winter gear for ages 2–14. Free shipping over $50.', brand: 'Little Trail', promo: '40% off', ends: 24 * 5, cta: 'Shop the sale', tags: ['kids clothes', 'winter', 'sale'], icon: 'snowflake', colors: ['#2193B0', '#6DD5ED'], sponsored: true, age: 35 },
  { id: 'k3', cat: 'kids', kind: 'local', title: 'Trampoline Park: Kids Jump Free', sub: 'With one paid adult, Tuesdays', desc: 'One child jumps free with each paying adult every Tuesday. Socks required.', brand: 'Bounce Zone', promo: 'Kids free', ends: 24 * 6, cta: 'Get directions', tags: ['family', 'activity', 'kids'], icon: 'human-child', colors: ['#FF416C', '#FF4B2B'], near: [-4.0, -0.6, '7700 N Kendall Dr', 'Bounce Zone'], rating: 4.4, age: 66 },
  { id: 'k4', cat: 'kids', title: 'Wooden Play Kitchen', desc: 'Solid wood play kitchen with working knobs, sink and 12 accessories.', brand: 'Oak & Acorn', price: 149, was: 199, ends: 24 * 15, cta: 'Shop now', tags: ['toys', 'gift', 'christmas', 'toddler'], icon: 'stove', colors: ['#D4A373', '#FAEDCD'], affiliate: true, rating: 4.9, age: 99 },
];

const KM_PER_DEG_LAT = 110.574;

function offsetPoint(anchor: GeoPoint, northKm: number, eastKm: number): GeoPoint {
  const lat = anchor.lat + northKm / KM_PER_DEG_LAT;
  const lng = anchor.lng + eastKm / (111.32 * Math.cos((anchor.lat * Math.PI) / 180));
  return { lat, lng };
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Build the sample catalog relative to `now` and an anchor location. */
export function buildSampleOffers(now: Date = new Date(), anchor: GeoPoint = DEFAULT_ANCHOR): Offer[] {
  anchor = anchor ?? DEFAULT_ANCHOR;
  const t = now.getTime();
  const iso = (h: number) => new Date(t + h * 3600_000).toISOString();
  return SEEDS.map((s) => {
    const usd = (amount: number) => ({ amount, currency: 'USD' });
    const offer: Offer = {
      id: `sample-${s.id}`,
      source: 'sample',
      kind: s.kind ?? (s.near ? 'local' : 'product'),
      category: s.cat,
      title: s.title,
      subtitle: s.sub,
      description: s.desc,
      advertiser: { id: slug(s.brand), name: s.brand, verified: !!s.sponsored },
      creative: { colors: s.colors, icon: s.icon },
      price: s.price != null ? usd(s.price) : undefined,
      originalPrice: s.was != null ? usd(s.was) : undefined,
      promoLabel: s.promo,
      promoCode: s.code,
      startsAt: iso(-(s.age ?? 24)),
      expiresAt: s.ends != null ? iso(s.ends) : undefined,
      ctaLabel: s.cta ?? 'View offer',
      // Sample offers deliberately point at a non-routable demo domain.
      url: `https://example.com/onlyads-demo/${slug(s.brand)}/${s.id}`,
      tags: s.tags,
      sponsored: !!s.sponsored,
      affiliate: !!s.affiliate,
      demo: true,
      // Demo verification times: every few hours, like a scheduled feed refresh.
      verifiedAt: iso(-((s.age ?? 24) % 7) - 0.5),
      availability: s.near ? undefined : { online: true },
      rating: s.rating,
      createdAt: iso(-(s.age ?? 24)),
    };
    if (s.near) {
      const p = offsetPoint(anchor, s.near[0], s.near[1]);
      offer.location = { ...p, address: s.near[2], placeName: s.near[3] };
    }
    return offer;
  });
}
