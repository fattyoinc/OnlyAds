import type { Category, CategoryId } from '@/types/offer';

export const CATEGORIES: Category[] = [
  { id: 'food', name: 'Food & Drink', icon: 'food', colors: ['#E8663A', '#F29A62'], blurb: 'Restaurant deals & delivery promos' },
  { id: 'fashion', name: 'Fashion', icon: 'hanger', colors: ['#C2418B', '#D96BA8'], blurb: 'Drops, sales & new collections' },
  { id: 'sneakers', name: 'Sneakers', icon: 'shoe-sneaker', colors: ['#2F6FDE', '#5B8FEA'], blurb: 'Releases, restocks & markdowns' },
  { id: 'tech', name: 'Tech', icon: 'cellphone', colors: ['#5B5BD6', '#8080E3'], blurb: 'Gadgets, audio & smart home' },
  { id: 'home', name: 'Home', icon: 'sofa-outline', colors: ['#B07A4F', '#C99B75'], blurb: 'Furniture, decor & kitchen' },
  { id: 'beauty', name: 'Beauty', icon: 'lipstick', colors: ['#E06C8C', '#EC95AD'], blurb: 'Skincare, makeup & fragrance' },
  { id: 'travel', name: 'Travel', icon: 'airplane', colors: ['#1E96C8', '#4FB3DC'], blurb: 'Flights, stays & getaways' },
  { id: 'fitness', name: 'Fitness', icon: 'dumbbell', colors: ['#1FA37A', '#4CC197'], blurb: 'Gyms, gear & wellness' },
  { id: 'gifts', name: 'Gift Ideas', icon: 'gift-outline', colors: ['#D64545', '#E36F6F'], blurb: 'Curated gifts for everyone' },
  { id: 'entertainment', name: 'Entertainment', icon: 'ticket-confirmation-outline', colors: ['#8A4FD8', '#A77BE4'], blurb: 'Streaming, games & events' },
  { id: 'grocery', name: 'Grocery', icon: 'basket-outline', colors: ['#5FA83B', '#83C163'], blurb: 'Weekly specials & delivery' },
  { id: 'kids', name: 'Kids & Family', icon: 'teddy-bear', colors: ['#E39B12', '#F0B84A'], blurb: 'Toys, clothes & activities' },
];

const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: CategoryId): Category {
  return byId.get(id)!;
}

/** Quick-intent shortcuts shown on the home screen ("I'm hungry", ...). */
export const INTENTS: { id: string; label: string; emojiIcon: string; query?: string; category?: CategoryId; nearby?: boolean }[] = [
  { id: 'hungry', label: 'Hungry', emojiIcon: 'silverware-fork-knife', category: 'food', nearby: true },
  { id: 'gifts', label: 'Gift shopping', emojiIcon: 'gift-outline', category: 'gifts' },
  { id: 'sneakers', label: 'New kicks', emojiIcon: 'shoe-sneaker', category: 'sneakers' },
  { id: 'ending', label: 'Ending soon', emojiIcon: 'timer-sand', query: '' },
  { id: 'getaway', label: 'Getaway', emojiIcon: 'beach', category: 'travel' },
  { id: 'treat', label: 'Treat myself', emojiIcon: 'star-four-points-outline', category: 'beauty' },
];
