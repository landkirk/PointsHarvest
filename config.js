export const REWARDS_URL = 'https://rewards.bing.com/';

export const MIN_SEARCHES = 12;
export const MAX_SEARCHES = 17; // random target count per run

// Each activity entry has a `queries` pool — one is picked at random each run.
export const ACTIVITY_KEYWORD_MAP = [
  { keywords: ['weather', 'forecast'], queries: [
    'weather forecast this week',
    'weather today and this weekend forecast',
    '10 day weather forecast near me',
  ]},
  { keywords: ['time', 'timezone', 'zone'], queries: [
    'what time is it in tokyo japan right now',
    'current time in london england uk',
    'what time is it in sydney australia',
  ]},
  { keywords: ['translate', 'translation'], queries: [
    'translate bonjour from french to english',
    'translate hola from spanish to english',
    'how do you say thank you in japanese',
  ]},
  { keywords: ['vocabulary', 'word', 'meaning', 'define'], queries: [
    'define serendipity meaning vocabulary',
    'what does ephemeral mean definition',
    'meaning of the word ubiquitous',
  ]},
  { keywords: ['lyric', 'song'], queries: [
    'bohemian rhapsody queen song lyrics',
    'imagine john lennon full lyrics',
    'hotel california eagles song lyrics',
  ]},
  { keywords: ['movie', 'film', 'cinema'], queries: [
    'best new movies to watch 2025',
    'top rated movies on streaming 2025',
    'best action movies in theaters 2025',
  ]},
  { keywords: ['cruise', 'sail'], queries: [
    'best caribbean cruise deals 2025',
    'alaska cruise packages and deals 2025',
    'mediterranean cruise itineraries 2025',
  ]},
  { keywords: ['concert', 'ticket', 'show'], queries: [
    'concert tickets near me 2025 live events',
    'upcoming music concerts in my city 2025',
    'live music events tickets this weekend',
  ]},
  { keywords: ['flower', 'delivery', 'smile'], queries: [
    'same day flower delivery near me bouquet',
    'best flower delivery service online',
    'send flowers next day delivery roses',
  ]},
  { keywords: ['home', 'renovation', 'upgrade', 'space'], queries: [
    'home renovation improvement ideas on a budget',
    'kitchen remodel ideas and costs 2025',
    'bathroom renovation tips and inspiration',
  ]},
  { keywords: ['internet', 'broadband', 'provider'], queries: [
    'best internet service providers comparison 2025',
    'fastest internet providers in my area',
    'compare cable vs fiber internet plans',
  ]},
  { keywords: ['credit card', 'swipe', 'rate'], queries: [
    'best cashback rewards credit cards 2025',
    'top travel rewards credit cards 2025',
    'credit cards with best sign up bonus 2025',
  ]},
  { keywords: ['car', 'vehicle', 'auto', 'road'], queries: [
    'used cars for sale near me under 20000',
    'best new cars to buy in 2025',
    'certified pre-owned cars deals near me',
  ]},
  { keywords: ['insurance'], queries: [
    'best home insurance plans comparison 2025',
    'cheapest car insurance quotes online',
    'compare health insurance plans 2025',
  ]},
  { keywords: ['diy', 'craft', 'creative', 'kit'], queries: [
    'DIY craft kit ideas for adults beginners',
    'fun diy home decoration project ideas',
    'best craft kits for adults 2025',
  ]},
  { keywords: ['book', 'read', 'novel'], queries: [
    'best books to read 2025 popular fiction',
    'top rated novels 2025 goodreads list',
    'best thriller books to read right now',
  ]},
  { keywords: ['deal', 'shop', 'shopping'], queries: [
    'best online shopping deals electronics today',
    'amazon deals today discount offers',
    'best buy sale items and deals this week',
  ]},
];

// Larger pool — shuffled each run, drawn from as needed to pad to target count.
export const GENERAL_SEARCH_POOL = [
  'latest technology news 2025',
  'best programming languages to learn 2025',
  'healthy quick dinner recipes easy',
  'beginner home workout routine no equipment',
  'best europe travel destinations summer 2025',
  'personal finance budgeting tips save money',
  'best national parks hiking trails usa',
  'roman empire history interesting facts',
  'nasa space exploration missions 2025',
  'artificial intelligence breakthroughs news',
  'best shows to stream right now 2025',
  'photography tips beginners improve photos',
  'how to learn a new language fast tips',
  'best coffee recipes to make at home',
  'yoga poses for beginners morning routine',
  'history of ancient egypt and pyramids',
  'best documentaries to watch on netflix 2025',
  'how to grow vegetables at home garden',
  'top smartphone apps for productivity 2025',
  'world news headlines today',
  'best board games for adults game night',
  'how to meditate for beginners stress relief',
  'famous landmarks to visit in europe travel',
  'best healthy snacks for weight loss',
  'how does solar energy work explained simply',
];
