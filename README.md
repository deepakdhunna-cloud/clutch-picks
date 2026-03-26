# Clutch Picks - Sports Prediction App

An AI-powered sports prediction app that helps you make informed decisions on games.

## Subscription

- **3-Day Free Trial** - Try all premium features free
- **$6.99/month** - Full access after trial
- Cancel anytime, no commitment

## Authentication

- **Sign in with Apple** - Quick and secure Apple ID login
- **Sign in with Google** - Coming soon
- **Email Sign In** - Passwordless OTP verification

## Features

### Sports Coverage
- **Pro Sports**: NFL, NBA, MLB, NHL, MLS, EPL
- **College Sports**: NCAAF, NCAAB

### Game Information
- Team records (wins/losses)
- Game date and time
- Where to watch (TV channel)
- Venue information

### Advanced Predictions Engine (Multi-Factor, Data-Driven)

Every game prediction is powered by real-time ESPN data + OpenAI GPT-4o-mini analysis:

**5 Weighted Prediction Factors:**
1. **Win % Differential** (22%) — Season record comparison with 2.5x sensitivity multiplier
2. **Recent Form / Last 10 Games** (28%) — Real ESPN team schedule data, fetched live (10-min cache)
3. **Home/Away Advantage** (15%) — Sport-specific venue edge (NBA 0.35, NCAAB 0.40, NFL 0.25, etc.)
4. **Point Differential** (25%) — Avg points scored vs allowed from recent form, sport-normalized with tighter scales
5. **Current Streak** (10%) — Live winning/losing streak data

**Probability Model:**
- Sigmoid-based probability conversion with 5.0x scaling for more decisive predictions
- Confidence directly maps winner probability (52-95% range) — minimum 52% floor
- Win probability range 8-92% for wider spread
- Edge rating uses power curve (exponent 0.6) for more aggressive high-confidence rewards
- Value rating is sport-aware (MLB/NHL use 1.5pt scale, NFL uses 3.5pt, MLS/EPL use 1.0pt)
- Spread multiplied by 1.15x for closer alignment to real Vegas lines
- Tighter point differential normalization (NFL: 10, NBA: 12, MLB: 1.2, NHL: 0.8)

**Output per game:**
- Predicted winner with confidence (52–95%)
- Home/Away win probability (e.g., 63% vs 37%)
- Real spread & over/under (from ESPN odds when available, model-calculated otherwise)
- Edge Rating (1–10): How strong the pick is
- Value Rating (1–10): How much value vs the market spread
- Recent form string: "W-W-L-W-L" for each team (last 10 games)
- Current streak: e.g., W3 or L2
- AI-written analysis using GPT-4o-mini with actual factor data

**Clutch Picks / Top Picks Ranking:**
- Uses composite score: 60% confidence + 25% edge rating + 15% value rating
- Best composite score per sport is selected as the top pick for that sport
- #1 overall pick = highest composite score across all sports

**Data Sources:**
- ESPN public API for live schedules, scores, records, team stats
- ESPN team schedule endpoint for recent form (last 10 games per team, 10-min cache)
- ESPN odds data for spread/over-under when available
- OpenAI GPT-4o-mini for natural language analysis (1-hour cache per game)

### AI Predictions
- Win probability with confidence percentage
- Market favorite with spread
- Over/under lines
- AI analysis explaining the prediction
- **News-based confidence fluctuations** - Confidence adjusts based on player news (injuries, trades, etc.)

### Community Features
- **Group Chat Interface**: Real-time chat-style discussion board
- **@ Mentions**: Tag other users by typing @ to mention followers/following
- **Text & Image Posts**: Share thoughts with optional image uploads
- **Likes & Comments**: Engage with community content
- **Sport-Specific Badges**: NFL, NBA, MLB themed discussions

### Social Features
- **Follow System**: Follow other users to keep up with their picks
- **User Profiles**: View other users' stats and recent picks
- **Follower/Following Counts**: See your network size
- **Private Profiles**: Option to make your profile private
- **Win Rate & Streak Tracking**: Show off your prediction success
- **User Badges**: Hot Streak, Expert Picker, Veteran badges
- **Share Profile**: Copy profile link to share
- **Direct Messaging**: Send private messages to other users
- **DM Inbox**: View all conversations, teal-accented messaging UI
- **Message from Profile**: Tap Message on any user's profile to start a DM
- **Challenge**: Challenge other users (coming soon)

### Team Colors & Branding
- **Real Team Colors**: All NFL, NBA, MLB, NHL teams with official colors
- **Team Color Gradients**: Game cards feature team-specific color gradients
- **Faded Colors for Upcoming Games**: Team colors are subtly faded on upcoming game cards, then restored to full intensity when games go live
- **Premium Dark Theme**: Black backgrounds with silver accents
- **Dark Luxurious Glass Effect**: Game cards feature deep obsidian glass with subtle silver reflections and premium shimmer effects

### Live Game Experience
- **Dedicated Live Layout**: Live games have a special card design focused on the action
- **Large Team Jerseys**: Bigger jerseys (72px) displayed side-by-side for live games
- **Animated Scores**: Scores pulse and animate below each jersey
- **Pulsing Red Glow**: Live game cards have a pulsing red border glow effect
- **Channel Display**: TV channel shown prominently at top (e.g., "LIVE on ESPN")
- **Simplified View**: No community picks or odds during live games - just the action

### Date Filtering
- **Today-Only Games**: Backend `/api/games` returns only today's games (end-of-day cutoff), plus yesterday's LIVE games. No tomorrow games leak in.
- **Frontend Safety Filter**: Home screen additionally filters `nonLiveGames` to yesterday-through-end-of-today window to handle UTC timezone edge cases.
- **Empty State**: "No games scheduled for today" only shows when both live and scheduled games are empty.

### Real-Time Market Picks
- **Live Market Data**: Pick percentages update every 3 seconds with market momentum
- **Team Color Progress Bars**: Progress bars use actual team colors for each side
- **Team Abbreviation Circles**: Circular badges with team abbreviation and colors
- **Market Picks Chart**: Line chart showing pick momentum over time on game detail page
- **Historical Data Points**: Chart displays last 10 data points of market movement
- **Animated Transitions**: Smooth animations when percentages shift

## App Structure

### Mobile App (`/mobile`)
- **Home Tab**: Today's games and featured predictions
- **Sports Tab**: Browse all sports categories
- **Community Tab**: Discussion board for all users
- **Profile Tab**: Your stats, settings, and social connections
- **Sport Detail**: View all games for a specific sport
- **Game Detail**: Full prediction breakdown with news feed
- **User Profiles**: View other users' profiles and follow them
- **Followers/Following**: See your connections
- **Messages**: DM inbox with conversation list
- **Conversation**: Real-time chat thread with message bubbles

### Backend API (`/backend`)

#### Sports & Predictions
- `GET /api/games` - Get all games for today across all sports (NFL, NBA, MLB, NHL)
- `GET /api/games/:sport` - Games for a specific sport (supports ?date=YYYY-MM-DD)
- `GET /api/games/date/:date` - Games for a specific date
- `GET /api/games/id/:id` - Get a specific game by ID
- `GET /api/sports` - List all sports with game counts
- `GET /api/sports/:sport/games` - Games for a specific sport
- `GET /api/sports/games/today` - Today's games
- `GET /api/sports/games/upcoming` - Next 7 days of games
- `GET /api/sports/games/:gameId` - Single game with prediction
- `GET /api/sports/predictions/:gameId` - AI prediction details

### Real-Time Game Data
The app fetches live game data from ESPN's unofficial API for all 8 sports:
- **NFL** - Football games
- **NBA** - Basketball games
- **MLB** - Baseball games
- **NHL** - Hockey games
- **MLS** - Soccer games
- **NCAAF** - College football
- **NCAAB** - College basketball
- **EPL** - Premier League

All game data is **real-time from ESPN** with **AI predictions** automatically attached to every game. No mock data is used for games or predictions.

**AI Predictions on Every Game:**
- Win probability and predicted winner
- Confidence percentage (50-95%)
- Spread and over/under (uses ESPN odds when available, AI-generated otherwise)
- AI analysis text explaining the prediction

**Real-Time Data Refresh System:**
- **Live Games**: Auto-refresh every 10 seconds for live score updates
- **Regular Games**: Auto-refresh every 30 seconds (3-second stale time)
- **Game Data Cache**: 30-second server cache for fast responses
- **Prediction Cache**: 5-minute server cache (predictions don't change mid-game)
- **Team Form Cache**: 10-minute cache for recent form data
- **News & Analysis**: Updates every 2 minutes
- **Posts & Comments**: Refresh every 30-60 seconds
- **App Focus**: Automatic data refresh when app returns to foreground
- **Network Reconnect**: Automatic refresh when internet connection is restored
- **Pull-to-Refresh**: Manual refresh available on all screens

Games automatically refresh to show:
- Live scores and game status
- Current quarter/period and game clock on cards
- Betting odds (spread, over/under)
- TV channel information

#### Discussion Board
- `GET /api/discussion/posts` - Get all posts (paginated)
- `POST /api/discussion/posts` - Create a post
- `DELETE /api/discussion/posts/:id` - Delete own post
- `POST /api/discussion/posts/:id/like` - Like a post
- `DELETE /api/discussion/posts/:id/like` - Unlike a post
- `GET /api/discussion/posts/:id/comments` - Get comments
- `POST /api/discussion/posts/:id/comments` - Add comment

#### Social Features
- `POST /api/social/follow/:userId` - Follow a user
- `DELETE /api/social/unfollow/:userId` - Unfollow a user
- `GET /api/social/followers/:userId` - Get followers list
- `GET /api/social/following/:userId` - Get following list
- `GET /api/social/stats/:userId` - Get follower/following counts

#### Direct Messages
- `GET /api/messages/conversations` - List all conversations
- `POST /api/messages/conversations/:userId` - Get or create a conversation
- `GET /api/messages/conversations/:id/messages` - Get messages in a conversation
- `POST /api/messages/conversations/:id/messages` - Send a message

#### Picks
- `GET /api/picks/user/:userId` - Get a user's recent public picks

#### Player News
- `GET /api/news` - Get recent news affecting confidence
- `GET /api/news/team/:teamId` - News for specific team
- `GET /api/news/player/:playerId` - News for specific player

### Data Sources
- **Games & Scores**: Real-time ESPN API (30-second cache, 10-second polling for live games, 5-minute prediction cache)
- **AI Predictions**: Generated server-side using team records, home field advantage, and seeded randomness for consistency
- **Discussion Posts & Comments**: Real database (Prisma/SQLite) - user-generated content
- **News**: Real database - affects AI confidence adjustments
- **Picks**: Real database - tracked per user per game
- **Social Features**: Real database - follows, profiles, DMs

## Theme

The app uses a professional sports-inspired color scheme:
- **NFL Blue** (#013369) - Primary accent
- **NBA Red** (#C8102E) - Secondary accent
- **MLB Blue** (#002D72) - Tertiary accent
- **Silver** (#C9CED6) - Highlights
- **Dark Gray Gradient** - Premium tab bar and cards
- **Pure Black** (#000000) - Backgrounds

## Tech Stack

- **Frontend**: React Native, Expo SDK 53, NativeWind
- **Backend**: Bun, Hono, Prisma (SQLite)
- **Auth**: Better Auth
- **State**: React Query, Zustand
- **Animations**: react-native-reanimated v3

## Performance Optimizations

- **FlatList tuning**: windowSize=7, maxToRenderPerBatch=8, removeClippedSubviews, getItemLayout for estimated sizing
- **React.memo**: GameCard, PredictionBadge, StatPill, PickHistoryItem, SettingsItem, SelectableSportButton all memoized
- **freezeOnBlur**: Inactive tabs stop rendering via freezeOnBlur
- **Structural sharing**: React Query structuralSharing enabled, gcTime 10min
- **Market polling reduced**: GameCard market updates every 60s instead of 30s
- **Backend caching**: Server cache TTL increased to 30s, prediction batching with concurrency limit
- **Parallel date search**: Game lookup by ID searches multiple dates in parallel
- **Cache-Control headers**: Games API returns cache-control for client-side caching
- **Native transitions**: ios_from_right animation on Stack navigator
- **useMemo**: Profile picks history and Sports game counts memoized
