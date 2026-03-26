import { Sport } from '@/types/sports';

// Team colors for jersey/logo display
export interface TeamColors {
  primary: string;
  secondary: string;
}

// NFL Teams
export const NFL_TEAM_COLORS: Record<string, TeamColors> = {
  // AFC East
  'BUF': { primary: '#00338D', secondary: '#C60C30' }, // Bills
  'MIA': { primary: '#008E97', secondary: '#FC4C02' }, // Dolphins
  'NE': { primary: '#002244', secondary: '#C60C30' },  // Patriots
  'NYJ': { primary: '#125740', secondary: '#FFFFFF' }, // Jets
  // AFC North
  'BAL': { primary: '#241773', secondary: '#000000' }, // Ravens
  'CIN': { primary: '#FB4F14', secondary: '#000000' }, // Bengals
  'CLE': { primary: '#311D00', secondary: '#FF3C00' }, // Browns
  'PIT': { primary: '#FFB612', secondary: '#101820' }, // Steelers
  // AFC South
  'HOU': { primary: '#03202F', secondary: '#A71930' }, // Texans
  'IND': { primary: '#002C5F', secondary: '#A2AAAD' }, // Colts
  'JAX': { primary: '#006778', secondary: '#D7A22A' }, // Jaguars
  'TEN': { primary: '#0C2340', secondary: '#4B92DB' }, // Titans
  // AFC West
  'DEN': { primary: '#FB4F14', secondary: '#002244' }, // Broncos
  'KC': { primary: '#E31837', secondary: '#FFB81C' },  // Chiefs
  'LV': { primary: '#000000', secondary: '#A5ACAF' },  // Raiders
  'LAC': { primary: '#0080C6', secondary: '#FFC20E' }, // Chargers
  // NFC East
  'DAL': { primary: '#003594', secondary: '#869397' }, // Cowboys
  'NYG': { primary: '#0B2265', secondary: '#A71930' }, // Giants
  'PHI': { primary: '#004C54', secondary: '#A5ACAF' }, // Eagles
  'WAS': { primary: '#5A1414', secondary: '#FFB612' }, // Commanders
  // NFC North
  'CHI': { primary: '#0B162A', secondary: '#C83803' }, // Bears
  'DET': { primary: '#0076B6', secondary: '#B0B7BC' }, // Lions
  'GB': { primary: '#203731', secondary: '#FFB612' },  // Packers
  'MIN': { primary: '#4F2683', secondary: '#FFC62F' }, // Vikings
  // NFC South
  'ATL': { primary: '#A71930', secondary: '#000000' }, // Falcons
  'CAR': { primary: '#0085CA', secondary: '#101820' }, // Panthers
  'NO': { primary: '#D3BC8D', secondary: '#101820' },  // Saints
  'TB': { primary: '#D50A0A', secondary: '#FF7900' },  // Buccaneers
  // NFC West
  'ARI': { primary: '#97233F', secondary: '#000000' }, // Cardinals
  'LAR': { primary: '#003594', secondary: '#FFD100' }, // Rams
  'SF': { primary: '#AA0000', secondary: '#B3995D' },  // 49ers
  'SEA': { primary: '#002244', secondary: '#69BE28' }, // Seahawks
};

// NBA Teams
export const NBA_TEAM_COLORS: Record<string, TeamColors> = {
  // Atlantic
  'BOS': { primary: '#007A33', secondary: '#BA9653' }, // Celtics
  'BKN': { primary: '#000000', secondary: '#FFFFFF' }, // Nets
  'BKYN': { primary: '#000000', secondary: '#FFFFFF' }, // Nets (ESPN alias)
  'NYK': { primary: '#006BB6', secondary: '#F58426' }, // Knicks
  'NY': { primary: '#006BB6', secondary: '#F58426' }, // Knicks (ESPN alias)
  'PHI': { primary: '#006BB6', secondary: '#ED174C' }, // 76ers
  'TOR': { primary: '#CE1141', secondary: '#000000' }, // Raptors
  // Central
  'CHI': { primary: '#CE1141', secondary: '#000000' }, // Bulls
  'CLE': { primary: '#860038', secondary: '#FDBB30' }, // Cavaliers
  'DET': { primary: '#C8102E', secondary: '#1D42BA' }, // Pistons
  'IND': { primary: '#002D62', secondary: '#FDBB30' }, // Pacers
  'MIL': { primary: '#00471B', secondary: '#EEE1C6' }, // Bucks
  // Southeast
  'ATL': { primary: '#E03A3E', secondary: '#C1D32F' }, // Hawks
  'CHA': { primary: '#1D1160', secondary: '#00788C' }, // Hornets
  'CHAR': { primary: '#1D1160', secondary: '#00788C' }, // Hornets (ESPN alias)
  'MIA': { primary: '#98002E', secondary: '#F9A01B' }, // Heat
  'ORL': { primary: '#0077C0', secondary: '#C4CED4' }, // Magic
  'WAS': { primary: '#002B5C', secondary: '#E31837' }, // Wizards
  'WSH': { primary: '#002B5C', secondary: '#E31837' }, // Wizards (ESPN alias)
  // Northwest
  'DEN': { primary: '#0E2240', secondary: '#FEC524' }, // Nuggets
  'MIN': { primary: '#0C2340', secondary: '#236192' }, // Timberwolves
  'OKC': { primary: '#007AC1', secondary: '#EF3B24' }, // Thunder
  'POR': { primary: '#E03A3E', secondary: '#000000' }, // Trail Blazers
  'UTA': { primary: '#002B5C', secondary: '#F9A01B' }, // Jazz
  'UTAH': { primary: '#002B5C', secondary: '#F9A01B' }, // Jazz (ESPN alias)
  // Pacific
  'GSW': { primary: '#1D428A', secondary: '#FFC72C' }, // Warriors
  'GS': { primary: '#1D428A', secondary: '#FFC72C' }, // Warriors (ESPN alias)
  'LAC': { primary: '#C8102E', secondary: '#1D428A' }, // Clippers
  'LAL': { primary: '#552583', secondary: '#FDB927' }, // Lakers
  'PHX': { primary: '#1D1160', secondary: '#E56020' }, // Suns
  'PHO': { primary: '#1D1160', secondary: '#E56020' }, // Suns (alias)
  'SAC': { primary: '#5A2D81', secondary: '#63727A' }, // Kings
  // Southwest
  'DAL': { primary: '#00538C', secondary: '#002B5E' }, // Mavericks
  'HOU': { primary: '#CE1141', secondary: '#000000' }, // Rockets
  'MEM': { primary: '#5D76A9', secondary: '#12173F' }, // Grizzlies
  'NOP': { primary: '#0C2340', secondary: '#C8102E' }, // Pelicans
  'NO': { primary: '#0C2340', secondary: '#C8102E' }, // Pelicans (ESPN alias)
  'SAS': { primary: '#C4CED4', secondary: '#000000' }, // Spurs
  'SA': { primary: '#C4CED4', secondary: '#000000' }, // Spurs (ESPN alias)
};

// MLB Teams
export const MLB_TEAM_COLORS: Record<string, TeamColors> = {
  // AL East
  'BAL': { primary: '#DF4601', secondary: '#000000' }, // Orioles
  'BOS': { primary: '#BD3039', secondary: '#0C2340' }, // Red Sox
  'NYY': { primary: '#0C2340', secondary: '#FFFFFF' }, // Yankees
  'TB': { primary: '#092C5C', secondary: '#8FBCE6' },  // Rays
  'TBR': { primary: '#092C5C', secondary: '#8FBCE6' },  // Rays (alias)
  'TOR': { primary: '#134A8E', secondary: '#E8291C' }, // Blue Jays
  // AL Central
  'CWS': { primary: '#27251F', secondary: '#C4CED4' }, // White Sox
  'CHW': { primary: '#27251F', secondary: '#C4CED4' }, // White Sox (ESPN alias)
  'CLE': { primary: '#00385D', secondary: '#E50022' }, // Guardians
  'DET': { primary: '#0C2340', secondary: '#FA4616' }, // Tigers
  'KC': { primary: '#004687', secondary: '#BD9B60' },  // Royals
  'KCR': { primary: '#004687', secondary: '#BD9B60' },  // Royals (alias)
  'MIN': { primary: '#002B5C', secondary: '#D31145' }, // Twins
  // AL West
  'HOU': { primary: '#002D62', secondary: '#EB6E1F' }, // Astros
  'LAA': { primary: '#BA0021', secondary: '#003263' }, // Angels
  'OAK': { primary: '#003831', secondary: '#EFB21E' }, // Athletics
  'ATH': { primary: '#003831', secondary: '#EFB21E' }, // Athletics (ESPN alias)
  'SEA': { primary: '#0C2C56', secondary: '#005C5C' }, // Mariners
  'TEX': { primary: '#003278', secondary: '#C0111F' }, // Rangers
  // NL East
  'ATL': { primary: '#CE1141', secondary: '#13274F' }, // Braves
  'MIA': { primary: '#00A3E0', secondary: '#EF3340' }, // Marlins
  'NYM': { primary: '#002D72', secondary: '#FF5910' }, // Mets
  'PHI': { primary: '#E81828', secondary: '#002D72' }, // Phillies
  'WAS': { primary: '#AB0003', secondary: '#14225A' }, // Nationals
  'WSH': { primary: '#AB0003', secondary: '#14225A' }, // Nationals (ESPN alias)
  // NL Central
  'CHC': { primary: '#0E3386', secondary: '#CC3433' }, // Cubs
  'CIN': { primary: '#C6011F', secondary: '#000000' }, // Reds
  'MIL': { primary: '#12284B', secondary: '#B6922E' }, // Brewers
  'PIT': { primary: '#27251F', secondary: '#FDB827' }, // Pirates
  'STL': { primary: '#C41E3A', secondary: '#0C2340' }, // Cardinals
  // NL West
  'ARI': { primary: '#A71930', secondary: '#E3D4AD' }, // Diamondbacks
  'AZ': { primary: '#A71930', secondary: '#E3D4AD' }, // Diamondbacks (alias)
  'COL': { primary: '#33006F', secondary: '#C4CED4' }, // Rockies
  'LAD': { primary: '#005A9C', secondary: '#EF3E42' }, // Dodgers
  'SD': { primary: '#2F241D', secondary: '#FFC425' },  // Padres
  'SF': { primary: '#FD5A1E', secondary: '#27251F' },  // Giants
};

// MLS Teams
export const MLS_TEAM_COLORS: Record<string, TeamColors> = {
  // Eastern Conference
  'ATL': { primary: '#80000A', secondary: '#A19060' }, // Atlanta United
  'CLT': { primary: '#1A85C8', secondary: '#000000' }, // Charlotte FC
  'CHI': { primary: '#FF0000', secondary: '#102B5C' }, // Chicago Fire
  'CIN': { primary: '#F05323', secondary: '#263B80' }, // FC Cincinnati
  'CLB': { primary: '#000000', secondary: '#FFDB00' }, // Columbus Crew
  'DC': { primary: '#000000', secondary: '#EF3E42' },  // DC United
  'IND': { primary: '#002F6C', secondary: '#B59C5A' }, // Inter Miami CF (also MIA)
  'MIA': { primary: '#F7B5CD', secondary: '#231F20' }, // Inter Miami
  'MTL': { primary: '#0033A1', secondary: '#000000' }, // CF Montreal
  'NE': { primary: '#0A2240', secondary: '#CE0E2D' },  // New England Revolution
  'NYC': { primary: '#6CACE4', secondary: '#041E42' }, // NYCFC
  'NYCFC': { primary: '#6CACE4', secondary: '#041E42' }, // NYCFC (alias)
  'NYRB': { primary: '#ED1E36', secondary: '#23326A' }, // NY Red Bulls
  'NY': { primary: '#ED1E36', secondary: '#23326A' }, // NY Red Bulls (ESPN alias)
  'ORL': { primary: '#633492', secondary: '#FDE192' }, // Orlando City
  'PHI': { primary: '#071B2C', secondary: '#B19B69' }, // Philadelphia Union
  'TOR': { primary: '#E31937', secondary: '#B81137' }, // Toronto FC
  // Western Conference
  'AUS': { primary: '#00B140', secondary: '#000000' }, // Austin FC
  'ATX': { primary: '#00B140', secondary: '#000000' }, // Austin FC (ESPN alias)
  'COL': { primary: '#862633', secondary: '#8BB8E8' }, // Colorado Rapids
  'DAL': { primary: '#E81F3E', secondary: '#2A4076' }, // FC Dallas
  'HOU': { primary: '#FF6B00', secondary: '#101820' }, // Houston Dynamo
  'LA': { primary: '#000000', secondary: '#FFD200' },  // LAFC
  'LAFC': { primary: '#000000', secondary: '#FFD200' },  // LAFC (ESPN alias)
  'LAG': { primary: '#00245D', secondary: '#FFD200' }, // LA Galaxy
  'MIN': { primary: '#8CD2F4', secondary: '#231F20' }, // Minnesota United
  'NSH': { primary: '#ECE83A', secondary: '#1F1646' }, // Nashville SC
  'POR': { primary: '#004812', secondary: '#D69A00' }, // Portland Timbers
  'RSL': { primary: '#B30838', secondary: '#013A81' }, // Real Salt Lake
  'SEA': { primary: '#5D9732', secondary: '#005595' }, // Seattle Sounders
  'SJ': { primary: '#0067B1', secondary: '#000000' },  // San Jose Earthquakes
  'SKC': { primary: '#002F65', secondary: '#91B0D5' }, // Sporting KC
  'STL': { primary: '#C8102E', secondary: '#0A1E41' }, // St. Louis CITY SC
  'SD': { primary: '#697A7C', secondary: '#000000' }, // San Diego FC (new team)
  'VAN': { primary: '#00245E', secondary: '#9DC2EA' }, // Vancouver Whitecaps
};

// EPL Teams (English Premier League)
export const EPL_TEAM_COLORS: Record<string, TeamColors> = {
  'ARS': { primary: '#EF0107', secondary: '#FFFFFF' }, // Arsenal
  'AVL': { primary: '#670E36', secondary: '#95BFE5' }, // Aston Villa
  'BOU': { primary: '#DA291C', secondary: '#000000' }, // Bournemouth
  'BRE': { primary: '#E30613', secondary: '#FBB800' }, // Brentford
  'BHA': { primary: '#0057B8', secondary: '#FFFFFF' }, // Brighton
  'BUR': { primary: '#6C1D45', secondary: '#99D6EA' }, // Burnley
  'CHE': { primary: '#034694', secondary: '#DBA111' }, // Chelsea
  'CRY': { primary: '#1B458F', secondary: '#C4122E' }, // Crystal Palace
  'EVE': { primary: '#003399', secondary: '#FFFFFF' }, // Everton
  'FUL': { primary: '#000000', secondary: '#CC0000' }, // Fulham
  'IPS': { primary: '#0033A0', secondary: '#D0312D' }, // Ipswich Town
  'LEI': { primary: '#003090', secondary: '#FDBE11' }, // Leicester City
  'LIV': { primary: '#C8102E', secondary: '#00B2A9' }, // Liverpool
  'LUT': { primary: '#F78F1E', secondary: '#002D62' }, // Luton Town
  'MCI': { primary: '#6CABDD', secondary: '#1C2C5B' }, // Man City
  'MUN': { primary: '#DA291C', secondary: '#FBE122' }, // Man United
  'NEW': { primary: '#241F20', secondary: '#FFFFFF' }, // Newcastle
  'NFO': { primary: '#E53233', secondary: '#FFFFFF' }, // Nottingham Forest
  'SHU': { primary: '#EE2737', secondary: '#FFFFFF' }, // Sheffield United
  'SOU': { primary: '#D71920', secondary: '#130C0E' }, // Southampton
  'TOT': { primary: '#132257', secondary: '#FFFFFF' }, // Tottenham
  'WHU': { primary: '#7A263A', secondary: '#1BB1E7' }, // West Ham
  'WOL': { primary: '#FDB913', secondary: '#231F20' }, // Wolves
};

// NCAAB Teams (NCAA Men's Basketball)
export const NCAAB_TEAM_COLORS: Record<string, TeamColors> = {
  // ACC
  'BC': { primary: '#8C2232', secondary: '#B29D6C' }, // Boston College - Maroon & Gold
  'CLEM': { primary: '#F56600', secondary: '#522D80' }, // Clemson - Orange & Purple
  'DUKE': { primary: '#003087', secondary: '#FFFFFF' }, // Duke - Blue & White
  'FSU': { primary: '#782F40', secondary: '#CEB888' }, // Florida State - Garnet & Gold
  'GT': { primary: '#B3A369', secondary: '#003057' }, // Georgia Tech - Gold & Navy
  'LOU': { primary: '#AD0000', secondary: '#000000' }, // Louisville - Red & Black
  'MIA': { primary: '#F47321', secondary: '#005030' }, // Miami - Orange & Green
  'UNC': { primary: '#7BAFD4', secondary: '#FFFFFF' }, // North Carolina - Carolina Blue & White
  'NCST': { primary: '#CC0000', secondary: '#FFFFFF' }, // NC State - Red & White
  'ND': { primary: '#0C2340', secondary: '#C99700' }, // Notre Dame - Navy & Gold
  'PITT': { primary: '#003594', secondary: '#FFB81C' }, // Pittsburgh - Blue & Gold
  'CUSE': { primary: '#F76900', secondary: '#002D74' }, // Syracuse - Orange & Blue
  'UVA': { primary: '#232D4B', secondary: '#F84C1E' }, // Virginia - Navy & Orange
  'VT': { primary: '#861F41', secondary: '#E5751F' }, // Virginia Tech - Maroon & Orange
  'WAKE': { primary: '#9E7E38', secondary: '#000000' }, // Wake Forest - Gold & Black
  'CAL': { primary: '#003262', secondary: '#FDB515' }, // California - Blue & Gold
  'SMC': { primary: '#003DA5', secondary: '#D50032' }, // Saint Mary's - Blue & Red
  'STAN': { primary: '#8C1515', secondary: '#FFFFFF' }, // Stanford - Cardinal & White

  // Big 12
  'BAY': { primary: '#154734', secondary: '#FFB81C' }, // Baylor - Green & Gold
  'ISU': { primary: '#C8102E', secondary: '#F1BE48' }, // Iowa State - Red & Gold
  'KU': { primary: '#0051BA', secondary: '#E8000D' }, // Kansas - Blue & Red
  'KSU': { primary: '#512888', secondary: '#FFFFFF' }, // Kansas State - Purple & White
  'OKST': { primary: '#FF6600', secondary: '#000000' }, // Oklahoma State - Orange & Black
  'OU': { primary: '#841617', secondary: '#FDF9D8' }, // Oklahoma - Crimson & Cream
  'TCU': { primary: '#4D1979', secondary: '#FFFFFF' }, // TCU - Purple & White
  'TEX': { primary: '#BF5700', secondary: '#FFFFFF' }, // Texas - Burnt Orange & White
  'TTU': { primary: '#CC0000', secondary: '#000000' }, // Texas Tech - Red & Black
  'WVU': { primary: '#002855', secondary: '#EAAA00' }, // West Virginia - Blue & Gold
  'ARIZ': { primary: '#003366', secondary: '#CC0033' }, // Arizona - Navy & Red
  'ASU': { primary: '#8C1D40', secondary: '#FFC627' }, // Arizona State - Maroon & Gold
  'BYU': { primary: '#002E5D', secondary: '#FFFFFF' }, // BYU - Navy & White
  'COLO': { primary: '#CFB87C', secondary: '#000000' }, // Colorado - Gold & Black
  'CIN': { primary: '#E00122', secondary: '#000000' }, // Cincinnati - Red & Black
  'HOU': { primary: '#C8102E', secondary: '#FFFFFF' }, // Houston - Red & White
  'UCF': { primary: '#BA9B37', secondary: '#000000' }, // UCF - Gold & Black
  'UTAH': { primary: '#CC0000', secondary: '#FFFFFF' }, // Utah - Red & White

  // Big East
  'BUT': { primary: '#13294B', secondary: '#FFFFFF' }, // Butler - Navy & White
  'CREI': { primary: '#005CA9', secondary: '#FFFFFF' }, // Creighton - Blue & White
  'DEP': { primary: '#005EB8', secondary: '#E4002B' }, // DePaul - Blue & Red
  'GTWN': { primary: '#041E42', secondary: '#8D817B' }, // Georgetown - Navy & Gray
  'MARQ': { primary: '#003366', secondary: '#FFCC00' }, // Marquette - Navy & Gold
  'PROV': { primary: '#000000', secondary: '#FFFFFF' }, // Providence - Black & White
  'SHU': { primary: '#004488', secondary: '#FFFFFF' }, // Seton Hall - Blue & White
  'SJU': { primary: '#C41E3A', secondary: '#FFFFFF' }, // St. John's - Red & White
  'NOVA': { primary: '#002D62', secondary: '#FFFFFF' }, // Villanova - Navy & White
  'XAV': { primary: '#002D62', secondary: '#FFFFFF' }, // Xavier - Navy & White
  'CONN': { primary: '#0E1A35', secondary: '#FFFFFF' }, // UConn - Navy & White

  // Big Ten
  'ILL': { primary: '#E84A27', secondary: '#13294B' }, // Illinois - Orange & Navy
  'IND': { primary: '#990000', secondary: '#FFFFFF' }, // Indiana - Crimson & White
  'IOWA': { primary: '#FFCD00', secondary: '#000000' }, // Iowa - Gold & Black
  'MD': { primary: '#E21833', secondary: '#FFD520' }, // Maryland - Red & Gold
  'MICH': { primary: '#00274C', secondary: '#FFCB05' }, // Michigan - Navy & Maize
  'MSU': { primary: '#18453B', secondary: '#FFFFFF' }, // Michigan State - Green & White
  'MINN': { primary: '#7A0019', secondary: '#FFCC33' }, // Minnesota - Maroon & Gold
  'NEB': { primary: '#E41C38', secondary: '#FFFFFF' }, // Nebraska - Red & White
  'NW': { primary: '#4E2A84', secondary: '#FFFFFF' }, // Northwestern - Purple & White
  'OSU': { primary: '#BB0000', secondary: '#FFFFFF' }, // Ohio State - Scarlet & White
  'PSU': { primary: '#041E42', secondary: '#FFFFFF' }, // Penn State - Navy & White
  'PUR': { primary: '#CEB888', secondary: '#000000' }, // Purdue - Gold & Black
  'RUTG': { primary: '#CC0033', secondary: '#FFFFFF' }, // Rutgers - Scarlet & White
  'WISC': { primary: '#C5050C', secondary: '#FFFFFF' }, // Wisconsin - Red & White
  'UCLA': { primary: '#2D68C4', secondary: '#F2A900' }, // UCLA - Blue & Gold
  'USC': { primary: '#990000', secondary: '#FFCC00' }, // USC - Cardinal & Gold
  'ORE': { primary: '#154733', secondary: '#FEE123' }, // Oregon - Green & Yellow
  'WASH': { primary: '#4B2E83', secondary: '#B7A57A' }, // Washington - Purple & Gold

  // SEC
  'ALA': { primary: '#9E1B32', secondary: '#FFFFFF' }, // Alabama - Crimson & White
  'ARK': { primary: '#9D2235', secondary: '#FFFFFF' }, // Arkansas - Cardinal & White
  'AUB': { primary: '#0C2340', secondary: '#E87722' }, // Auburn - Navy & Orange
  'FLA': { primary: '#0021A5', secondary: '#FA4616' }, // Florida - Blue & Orange
  'UGA': { primary: '#BA0C2F', secondary: '#000000' }, // Georgia - Red & Black
  'UK': { primary: '#0033A0', secondary: '#FFFFFF' }, // Kentucky - Blue & White
  'LSU': { primary: '#461D7C', secondary: '#FDD023' }, // LSU - Purple & Gold
  'MISS': { primary: '#CE1126', secondary: '#14213D' }, // Ole Miss - Red & Navy
  'MSST': { primary: '#660000', secondary: '#FFFFFF' }, // Mississippi State - Maroon & White
  'MIZ': { primary: '#F1B82D', secondary: '#000000' }, // Missouri - Gold & Black
  'SCAR': { primary: '#73000A', secondary: '#000000' }, // South Carolina - Garnet & Black
  'TENN': { primary: '#FF8200', secondary: '#FFFFFF' }, // Tennessee - Orange & White
  'TAMU': { primary: '#500000', secondary: '#FFFFFF' }, // Texas A&M - Maroon & White
  'VAN': { primary: '#866D4B', secondary: '#000000' }, // Vanderbilt - Gold & Black

  // Pac-12 / West Coast
  'GONZ': { primary: '#002967', secondary: '#C8102E' }, // Gonzaga - Navy & Red
  'SF': { primary: '#006633', secondary: '#FDBB30' }, // San Francisco - Green & Gold
  'SDSU': { primary: '#A6192E', secondary: '#000000' }, // San Diego State - Red & Black
  'UNLV': { primary: '#CF0A2C', secondary: '#B1B3B3' }, // UNLV - Red & Silver
  'BSU': { primary: '#D64309', secondary: '#0033A0' }, // Boise State - Orange & Blue
  'USU': { primary: '#0F2439', secondary: '#FFFFFF' }, // Utah State - Navy & White
  'CSU': { primary: '#1E4D2B', secondary: '#C8C372' }, // Colorado State - Green & Gold
  'UNM': { primary: '#BA0C2F', secondary: '#A7A8AA' }, // New Mexico - Cherry & Silver
  'FRES': { primary: '#C41230', secondary: '#13294B' }, // Fresno State - Red & Navy
  'SJSU': { primary: '#0055A2', secondary: '#E5A823' }, // San Jose State - Blue & Gold
  'NEV': { primary: '#003366', secondary: '#FFFFFF' }, // Nevada - Navy & White
  'WYO': { primary: '#492F24', secondary: '#FFC425' }, // Wyoming - Brown & Gold
  'HAW': { primary: '#024731', secondary: '#FFFFFF' }, // Hawaii - Green & White

  // AAC / American
  'MEM': { primary: '#003087', secondary: '#FFFFFF' }, // Memphis - Blue & White
  'SMU': { primary: '#CC0035', secondary: '#0033A0' }, // SMU - Red & Blue
  'TLNE': { primary: '#005F3A', secondary: '#87CEEB' }, // Tulane - Green & Sky Blue
  'TLSA': { primary: '#002D62', secondary: '#C09E5E' }, // Tulsa - Navy & Gold
  'WIC': { primary: '#FFC72C', secondary: '#000000' }, // Wichita State - Gold & Black
  'TEM': { primary: '#9D2235', secondary: '#FFFFFF' }, // Temple - Cherry & White
  'ECU': { primary: '#592A8A', secondary: '#FFC72C' }, // East Carolina - Purple & Gold
  'USF': { primary: '#006747', secondary: '#CFC493' }, // South Florida - Green & Gold
  'UAB': { primary: '#1E6B52', secondary: '#FFC72C' }, // UAB - Green & Gold
  'FAU': { primary: '#003366', secondary: '#CC0000' }, // FAU - Navy & Red
  'CHAR': { primary: '#005035', secondary: '#B3A369' }, // Charlotte - Green & Gold
  'UNT': { primary: '#00853E', secondary: '#FFFFFF' }, // North Texas - Green & White
  'UTSA': { primary: '#0C2340', secondary: '#F15A22' }, // UTSA - Navy & Orange
  'RICE': { primary: '#002469', secondary: '#FFFFFF' }, // Rice - Blue & White
  'NAVY': { primary: '#00205B', secondary: '#C6993A' }, // Navy - Navy & Gold
  'ARMY': { primary: '#000000', secondary: '#D4BF92' }, // Army - Black & Gold

  // Mountain West
  'AIRG': { primary: '#003087', secondary: '#FFFFFF' }, // Air Force - Blue & White

  // A-10
  'DAY': { primary: '#CE1141', secondary: '#004B8D' }, // Dayton - Red & Blue
  'STL': { primary: '#003DA5', secondary: '#FFFFFF' }, // Saint Louis - Blue & White
  'SLU': { primary: '#003DA5', secondary: '#FFFFFF' }, // Saint Louis (alias)
  'VCU': { primary: '#F8B800', secondary: '#000000' }, // VCU - Gold & Black
  'RICH': { primary: '#990000', secondary: '#000066' }, // Richmond - Red & Blue
  'GW': { primary: '#004065', secondary: '#FFCC00' }, // George Washington - Navy & Gold
  'GMU': { primary: '#006633', secondary: '#FFCC33' }, // George Mason - Green & Gold
  'MASS': { primary: '#881C1C', secondary: '#FFFFFF' }, // UMass - Maroon & White
  'RHOD': { primary: '#75B2DD', secondary: '#041E42' }, // Rhode Island - Light Blue & Navy
  'FOR': { primary: '#012169', secondary: '#FFC72C' }, // Fordham - Navy & Gold
  'SBU': { primary: '#990000', secondary: '#FFFFFF' }, // St. Bonaventure - Brown & White
  'DUQ': { primary: '#002D62', secondary: '#BA0C2F' }, // Duquesne - Navy & Red
  'LAS': { primary: '#002A5C', secondary: '#FFC72C' }, // La Salle - Navy & Gold

  // Missouri Valley
  'DRKE': { primary: '#004477', secondary: '#FFFFFF' }, // Drake - Blue & White
  'BRAD': { primary: '#A51C30', secondary: '#FFFFFF' }, // Bradley - Red & White
  'LYL': { primary: '#800000', secondary: '#FFCC00' }, // Loyola Chicago - Maroon & Gold
  'ILS': { primary: '#C41230', secondary: '#FFFFFF' }, // Illinois State - Red & White
  'UNI': { primary: '#4B116F', secondary: '#FFCC00' }, // Northern Iowa - Purple & Gold
  'SIU': { primary: '#720000', secondary: '#FFFFFF' }, // Southern Illinois - Maroon & White
  'MSM': { primary: '#660000', secondary: '#FFFFFF' }, // Missouri State - Maroon & White
  'MOST': { primary: '#660000', secondary: '#FFFFFF' }, // Missouri State (alias)
  'WICH': { primary: '#FFC72C', secondary: '#000000' }, // Wichita State - Gold & Black
  'EVAN': { primary: '#663399', secondary: '#FF6600' }, // Evansville - Purple & Orange
  'IND ST': { primary: '#003D7C', secondary: '#FFFFFF' }, // Indiana State - Blue & White
  'VAL': { primary: '#4F3629', secondary: '#FDBB30' }, // Valparaiso - Brown & Gold

  // West Coast Conference
  'PEP': { primary: '#003DA5', secondary: '#FF6600' }, // Pepperdine - Blue & Orange
  'PORT': { primary: '#4F2D7F', secondary: '#FFFFFF' }, // Portland - Purple & White
  'LMU': { primary: '#002144', secondary: '#8B2346' }, // Loyola Marymount - Navy & Crimson
  'PAC': { primary: '#F47920', secondary: '#000000' }, // Pacific - Orange & Black
  'UST': { primary: '#5E017B', secondary: '#FFFFFF' }, // St. Thomas - Purple & White
  'SCU': { primary: '#862633', secondary: '#FFFFFF' }, // Santa Clara - Red & White
  'SDIEG': { primary: '#002F6C', secondary: '#A0CFEC' }, // San Diego - Navy & Light Blue

  // Ivy League
  'PRIN': { primary: '#EE7F2D', secondary: '#000000' }, // Princeton - Orange & Black
  'YALE': { primary: '#0F4D92', secondary: '#FFFFFF' }, // Yale - Blue & White
  'HARV': { primary: '#A51C30', secondary: '#FFFFFF' }, // Harvard - Crimson & White
  'DART': { primary: '#00693E', secondary: '#FFFFFF' }, // Dartmouth - Green & White
  'CORN': { primary: '#B31B1B', secondary: '#FFFFFF' }, // Cornell - Red & White
  'PENN': { primary: '#011F5B', secondary: '#990000' }, // Penn - Navy & Red
  'BRWN': { primary: '#4E3629', secondary: '#C00404' }, // Brown - Brown & Red
  'CLMB': { primary: '#9BDDFF', secondary: '#002B7F' }, // Columbia - Light Blue & Blue

  // Mid-Major Notables
  'NAU': { primary: '#003466', secondary: '#FFB300' }, // Northern Arizona - Blue & Gold
  'FAIR': { primary: '#CC092F', secondary: '#FFFFFF' }, // Fairfield - Red & White
  'IONA': { primary: '#6D0F1C', secondary: '#E0A526' }, // Iona - Maroon & Gold
  'MAN': { primary: '#BA0C2F', secondary: '#FFFFFF' }, // Manhattan - Red & White
  'SIE': { primary: '#046A38', secondary: '#FFC72C' }, // Siena - Green & Gold
  'NCAT': { primary: '#004684', secondary: '#B3A369' }, // NC A&T - Blue & Gold
  'AAMU': { primary: '#660000', secondary: '#FFFFFF' }, // Alabama A&M - Maroon & White
  'JST': { primary: '#003DA5', secondary: '#FF6600' }, // Jackson State - Blue & Orange
  'TSU': { primary: '#660000', secondary: '#FFFFFF' }, // Texas Southern - Maroon & White
  'ALCN': { primary: '#542F21', secondary: '#D4A04A' }, // Alcorn State - Brown & Gold
  'GRAM': { primary: '#000000', secondary: '#FFD700' }, // Grambling - Black & Gold
  'MVSU': { primary: '#016A37', secondary: '#FFFFFF' }, // Miss Valley St - Green & White
  'SOUT': { primary: '#0033A0', secondary: '#D4AF37' }, // Southern - Blue & Gold
  'PV': { primary: '#4F2D7F', secondary: '#D4AF37' }, // Prairie View - Purple & Gold

  // Additional Top Programs
  'STA': { primary: '#00205B', secondary: '#9A1D30' }, // St. Anthony's - Navy & Red
  'WKU': { primary: '#C60C30', secondary: '#FFFFFF' }, // Western Kentucky - Red & White
  'MTU': { primary: '#003366', secondary: '#FFC72C' }, // Middle Tennessee - Blue & Gold
  'ODU': { primary: '#003057', secondary: '#FFFFFF' }, // Old Dominion - Navy & White
  'MRSH': { primary: '#00B140', secondary: '#FFFFFF' }, // Marshall - Green & White
  'APP': { primary: '#000000', secondary: '#FFCC00' }, // Appalachian State - Black & Gold
  'GASO': { primary: '#003775', secondary: '#FFFFFF' }, // Georgia Southern - Blue & White
  'USM': { primary: '#000000', secondary: '#FFAB00' }, // Southern Miss - Black & Gold
  'TROY': { primary: '#8B2332', secondary: '#FFFFFF' }, // Troy - Maroon & White
  'ARK ST': { primary: '#000000', secondary: '#CC092F' }, // Arkansas State - Black & Red
  'LT': { primary: '#003087', secondary: '#CC0000' }, // Louisiana Tech - Blue & Red
  'ULL': { primary: '#CE181E', secondary: '#FFFFFF' }, // UL Lafayette - Red & White
  'ULM': { primary: '#800029', secondary: '#B3A369' }, // UL Monroe - Maroon & Gold
  'TXST': { primary: '#501214', secondary: '#8D734A' }, // Texas State - Maroon & Gold
  'JMU': { primary: '#450084', secondary: '#CBB677' }, // James Madison - Purple & Gold
  'COAST': { primary: '#006F71', secondary: '#A27752' }, // Coastal Carolina - Teal & Bronze
  'JKST': { primary: '#00205B', secondary: '#6D8D24' }, // Jacksonville State - Navy & Green
  'KEN': { primary: '#002649', secondary: '#FDBB30' }, // Kennesaw State - Navy & Gold
  'SAM': { primary: '#F78F1E', secondary: '#FFFFFF' }, // Sam Houston - Orange & White
  'WEBB': { primary: '#4F2D7F', secondary: '#000000' }, // Gardner-Webb
  'TOLS': { primary: '#003366', secondary: '#FFCC00' }, // Toledo
  'LIB': { primary: '#002D62', secondary: '#A50034' }, // Liberty
  'EKU': { primary: '#861F41', secondary: '#5A1029' }, // Eastern Kentucky - darker maroon secondary
  'WM': { primary: '#115740', secondary: '#B9975B' }, // William & Mary
  'ELON': { primary: '#73000A', secondary: '#B9975B' }, // Elon
  'UNCW': { primary: '#006666', secondary: '#FFCC00' }, // UNC Wilmington
  'DEL': { primary: '#00539B', secondary: '#FFD200' }, // Delaware
  'DREX': { primary: '#002C5F', secondary: '#FFCC00' }, // Drexel
  'HOF': { primary: '#002D62', secondary: '#0051BA' }, // Hofstra - blue secondary
  'NEU': { primary: '#CC0000', secondary: '#000000' }, // Northeastern
  'STNY': { primary: '#990000', secondary: '#660000' }, // Stony Brook - darker red secondary
  'TOW': { primary: '#FFB600', secondary: '#000000' }, // Towson
  'UNCG': { primary: '#003366', secondary: '#F0BC44' }, // UNC Greensboro
  'CHAT': { primary: '#003865', secondary: '#8B864E' }, // Chattanooga
  'ETSU': { primary: '#041E42', secondary: '#FFC72C' }, // ETSU
  'FMAN': { primary: '#582C83', secondary: '#3A1A5E' }, // Furman - darker purple secondary
  'MER': { primary: '#F37021', secondary: '#000000' }, // Mercer
  'SAM ST': { primary: '#002855', secondary: '#A7A8AA' }, // Samford
  'UNCWN': { primary: '#006666', secondary: '#D4AF37' }, // UNC Wilmington
  'VMI': { primary: '#C41E3A', secondary: '#FFC82E' }, // VMI
  'WOFF': { primary: '#000000', secondary: '#FFD700' }, // Wofford
  'ALBY': { primary: '#461D7C', secondary: '#EAAA00' }, // Albany - Purple & Gold
  'BRYT': { primary: '#231F20', secondary: '#FFC72C' }, // Bryant - Black & Gold
  'BRY': { primary: '#231F20', secondary: '#FFC72C' }, // Bryant (ESPN alias) - Black & Gold
  'MAINE': { primary: '#003263', secondary: '#B5D3E7' }, // Maine - Navy & Light Blue
  'UMBC': { primary: '#000000', secondary: '#F7B538' }, // UMBC - Black & Gold
  'UML': { primary: '#003DA5', secondary: '#CC0000' }, // UMass Lowell - Blue & Red
  'UNH': { primary: '#003DA5', secondary: '#FFFFFF' }, // New Hampshire - Blue & White
  'VER': { primary: '#003300', secondary: '#FFD100' }, // Vermont - Green & Gold
  'UVM': { primary: '#003300', secondary: '#FFD100' }, // Vermont (ESPN alias) - Green & Gold
  'BU': { primary: '#CC0000', secondary: '#FFFFFF' }, // Boston University - Red & White
  'COL': { primary: '#5D4B37', secondary: '#8C1515' }, // Colgate - Brown & Maroon
  'HOLY': { primary: '#602D89', secondary: '#FFFFFF' }, // Holy Cross - Purple & White
  'LAF': { primary: '#800000', secondary: '#FFFFFF' }, // Lafayette - Maroon & White
  'LEH': { primary: '#653819', secondary: '#FFFFFF' }, // Lehigh - Brown & White
  'BUCK': { primary: '#DD5600', secondary: '#003865' }, // Bucknell - Orange & Blue

  // Additional ESPN teams from today's games
  'ALST': { primary: '#E9A900', secondary: '#000000' }, // Alabama State - Gold & Black
  'APSU': { primary: '#8E0B0B', secondary: '#FFFFFF' }, // Austin Peay - Red & White
  'ARST': { primary: '#CC092F', secondary: '#000000' }, // Arkansas State - Red & Black
  'BCU': { primary: '#7B1831', secondary: '#F4A100' }, // Bethune-Cookman - Maroon & Gold
  'BING': { primary: '#00614A', secondary: '#FFFFFF' }, // Binghamton - Green & White
  'CAM': { primary: '#FF6600', secondary: '#000000' }, // Campbell - Orange & Black
  'CARK': { primary: '#4F2D7F', secondary: '#A7A9AC' }, // Central Arkansas - Purple & Gray
  'CBU': { primary: '#000080', secondary: '#FFD700' }, // California Baptist - Navy & Gold
  'CCSU': { primary: '#1B49A2', secondary: '#FFFFFF' }, // Central Connecticut - Blue & White
  'CHST': { primary: '#006700', secondary: '#FFFFFF' }, // Chicago State - Green & White
  'CIT': { primary: '#7BADD3', secondary: '#FFFFFF' }, // The Citadel - Blue & White
  'COFC': { primary: '#7A2531', secondary: '#FFFFFF' }, // Charleston - Maroon & White
  'CP': { primary: '#1E4D2B', secondary: '#FFD700' }, // Cal Poly - Green & Gold
  'CSUB': { primary: '#003BAB', secondary: '#FFC72C' }, // Cal State Bakersfield - Blue & Gold
  'CSUF': { primary: '#003767', secondary: '#FF6600' }, // Cal State Fullerton - Blue & Orange
  'CSUN': { primary: '#B50000', secondary: '#FFFFFF' }, // Cal State Northridge - Red & White
  'DEN': { primary: '#98002E', secondary: '#FFD700' }, // Denver - Crimson & Gold
  'EIU': { primary: '#004B83', secondary: '#FFFFFF' }, // Eastern Illinois - Blue & White
  'EWU': { primary: '#A10022', secondary: '#FFFFFF' }, // Eastern Washington - Red & White
  'FAMU': { primary: '#F89728', secondary: '#00843D' }, // Florida A&M - Orange & Green
  'FDU': { primary: '#72293C', secondary: '#FFFFFF' }, // Fairleigh Dickinson - Maroon & White
  'FIU': { primary: '#091F3F', secondary: '#B6862D' }, // Florida International - Navy & Gold
  'GAST': { primary: '#0039A6', secondary: '#CC0033' }, // Georgia State - Blue & Red
  'GWEB': { primary: '#C12535', secondary: '#FFD700' }, // Gardner-Webb - Red & Gold
  'HAMP': { primary: '#0067AC', secondary: '#FFFFFF' }, // Hampton - Blue & White
  'HPU': { primary: '#330072', secondary: '#FFFFFF' }, // High Point - Purple & White
  'IDHO': { primary: '#B5985A', secondary: '#000000' }, // Idaho - Gold & Black
  'IDST': { primary: '#EF8C00', secondary: '#000000' }, // Idaho State - Orange & Black
  'IUIN': { primary: '#A81F30', secondary: '#FFD700' }, // IU Indianapolis - Red & Gold
  'KC': { primary: '#004B87', secondary: '#FFD700' }, // Kansas City - Blue & Gold
  'LBSU': { primary: '#000000', secondary: '#FFD700' }, // Long Beach State - Black & Gold
  'LEM': { primary: '#006600', secondary: '#FFD700' }, // Le Moyne - Green & Gold
  'LIN': { primary: '#000000', secondary: '#FFD700' }, // Lindenwood - Black & Gold
  'LIU': { primary: '#50C9F7', secondary: '#000000' }, // Long Island University - Blue & Black
  'LONG': { primary: '#003273', secondary: '#FFFFFF' }, // Longwood - Blue & White
  'LR': { primary: '#AD0000', secondary: '#FFFFFF' }, // Little Rock - Red & White
  'MERC': { primary: '#004D44', secondary: '#FFD700' }, // Mercyhurst - Green & Gold
  'MONM': { primary: '#051844', secondary: '#FFFFFF' }, // Monmouth - Navy & White
  'MONT': { primary: '#751D4A', secondary: '#A7A8AA' }, // Montana - Maroon & Silver
  'MORE': { primary: '#094FA3', secondary: '#FFD700' }, // Morehead State - Blue & Gold
  'MTST': { primary: '#00205C', secondary: '#FFD700' }, // Montana State - Blue & Gold
  'NE': { primary: '#CC0001', secondary: '#000000' }, // Northeastern - Red & Black
  'NHVN': { primary: '#041E42', secondary: '#FFD700' }, // New Haven - Navy & Gold
  'NJIT': { primary: '#EE3024', secondary: '#003865' }, // NJIT - Red & Blue
  'PRES': { primary: '#194896', secondary: '#FFFFFF' }, // Presbyterian - Blue & White
  'PRST': { primary: '#00311E', secondary: '#FFFFFF' }, // Portland State - Green & White
  'RAD': { primary: '#BC1515', secondary: '#006400' }, // Radford - Red & Green
  'SAC': { primary: '#00573C', secondary: '#FFD700' }, // Sacramento State - Green & Gold
  'SDAK': { primary: '#CD1241', secondary: '#FFFFFF' }, // South Dakota - Red & White
  'SFPA': { primary: '#A20012', secondary: '#FFFFFF' }, // Saint Francis - Red & White
  'SIUE': { primary: '#EB1C23', secondary: '#FFFFFF' }, // SIU Edwardsville - Red & White
  'STET': { primary: '#0A5640', secondary: '#FFFFFF' }, // Stetson - Green & White
  'STO': { primary: '#003087', secondary: '#FFFFFF' }, // Stonehill - Blue & White
  'SUU': { primary: '#C72026', secondary: '#FFFFFF' }, // Southern Utah - Red & White
  'TAR': { primary: '#4F2683', secondary: '#FFFFFF' }, // Tarleton State - Purple & White
  'TNST': { primary: '#171796', secondary: '#FFFFFF' }, // Tennessee State - Blue & White
  'TNTC': { primary: '#5A4099', secondary: '#FFD700' }, // Tennessee Tech - Purple & Gold
  'TULN': { primary: '#006747', secondary: '#87CEEB' }, // Tulane - Green & Sky Blue
  'TXSO': { primary: '#860038', secondary: '#FFFFFF' }, // Texas Southern - Maroon & White
  'UALB': { primary: '#3D2777', secondary: '#FFD700' }, // UAlbany - Purple & Gold
  'UAPB': { primary: '#E0AA0F', secondary: '#000000' }, // Arkansas-Pine Bluff - Gold & Black
  'UCD': { primary: '#002855', secondary: '#FFBF00' }, // UC Davis - Navy & Gold
  'UCI': { primary: '#002B5C', secondary: '#FFD200' }, // UC Irvine - Navy & Gold
  'UCR': { primary: '#14234F', secondary: '#FFBF00' }, // UC Riverside - Navy & Gold
  'UCSB': { primary: '#1E1840', secondary: '#FFD700' }, // UC Santa Barbara - Navy & Gold
  'UL': { primary: '#CE181E', secondary: '#FFFFFF' }, // Louisiana - Red & White
  'UNCA': { primary: '#003DA5', secondary: '#FFFFFF' }, // UNC Asheville - Blue & White
  'UND': { primary: '#00A26B', secondary: '#FFFFFF' }, // North Dakota - Green & White
  'UNF': { primary: '#004B8D', secondary: '#A7A8AA' }, // North Florida - Blue & Gray
  'UPST': { primary: '#008545', secondary: '#000000' }, // South Carolina Upstate - Green & Black
  'USA': { primary: '#00205B', secondary: '#CC0000' }, // South Alabama - Navy & Red
  'USI': { primary: '#002F6C', secondary: '#CC0000' }, // Southern Indiana - Blue & Red
  'UTA': { primary: '#004B7C', secondary: '#FF6600' }, // UT Arlington - Blue & Orange
  'UTC': { primary: '#00386B', secondary: '#FFD700' }, // Chattanooga - Navy & Gold
  'UTM': { primary: '#FF6700', secondary: '#002D62' }, // UT Martin - Orange & Navy
  'UTU': { primary: '#BA0C2F', secondary: '#FFFFFF' }, // Utah Tech - Red & White
  'UVU': { primary: '#004812', secondary: '#FFFFFF' }, // Utah Valley - Green & White
  'W&M': { primary: '#115740', secondary: '#B9975B' }, // William & Mary - Green & Gold
  'WAG': { primary: '#00483A', secondary: '#FFFFFF' }, // Wagner - Green & White
  'WEB': { primary: '#18005A', secondary: '#FFFFFF' }, // Weber State - Purple & White
  'WIN': { primary: '#9E0B0E', secondary: '#FFD700' }, // Winthrop - Red & Gold
  'WIU': { primary: '#4E1E8A', secondary: '#FFD700' }, // Western Illinois - Purple & Gold
  'WRST': { primary: '#007A33', secondary: '#CBA052' }, // Wright State - Green & Gold
};

// NCAAF Teams (NCAA Football) - extends NFL colors with college teams
export const NCAAF_TEAM_COLORS: Record<string, TeamColors> = {
  ...NCAAB_TEAM_COLORS, // Most college teams share colors across sports
  // Override or add football-specific if needed
};

// NHL Teams
export const NHL_TEAM_COLORS: Record<string, TeamColors> = {
  // Atlantic
  'BOS': { primary: '#FFB81C', secondary: '#000000' }, // Bruins
  'BUF': { primary: '#002654', secondary: '#FCB514' }, // Sabres
  'DET': { primary: '#CE1126', secondary: '#FFFFFF' }, // Red Wings
  'FLA': { primary: '#041E42', secondary: '#C8102E' }, // Panthers
  'MTL': { primary: '#AF1E2D', secondary: '#192168' }, // Canadiens
  'OTT': { primary: '#000000', secondary: '#C52032' }, // Senators
  'TB': { primary: '#002868', secondary: '#FFFFFF' },  // Lightning
  'TBL': { primary: '#002868', secondary: '#FFFFFF' },  // Lightning (alias)
  'TOR': { primary: '#00205B', secondary: '#FFFFFF' }, // Maple Leafs
  // Metropolitan
  'CAR': { primary: '#CC0000', secondary: '#000000' }, // Hurricanes
  'CBJ': { primary: '#002654', secondary: '#CE1126' }, // Blue Jackets
  'NJ': { primary: '#CE1126', secondary: '#000000' },  // Devils
  'NJD': { primary: '#CE1126', secondary: '#000000' },  // Devils (alias)
  'NYI': { primary: '#00539B', secondary: '#F47D30' }, // Islanders
  'NYR': { primary: '#0038A8', secondary: '#CE1126' }, // Rangers
  'PHI': { primary: '#F74902', secondary: '#000000' }, // Flyers
  'PIT': { primary: '#FCB514', secondary: '#000000' }, // Penguins
  'WAS': { primary: '#041E42', secondary: '#C8102E' }, // Capitals
  'WSH': { primary: '#041E42', secondary: '#C8102E' }, // Capitals (ESPN alias)
  // Central
  'ARI': { primary: '#8C2633', secondary: '#E2D6B5' }, // Coyotes
  'CHI': { primary: '#CF0A2C', secondary: '#000000' }, // Blackhawks
  'COL': { primary: '#6F263D', secondary: '#236192' }, // Avalanche
  'DAL': { primary: '#006847', secondary: '#8F8F8C' }, // Stars
  'MIN': { primary: '#154734', secondary: '#DDCBA4' }, // Wild
  'NSH': { primary: '#FFB81C', secondary: '#041E42' }, // Predators
  'STL': { primary: '#002F87', secondary: '#FCB514' }, // Blues
  'WPG': { primary: '#041E42', secondary: '#AC162C' }, // Jets
  'UTA': { primary: '#6CACE4', secondary: '#000000' }, // Utah Mammoth (new team)
  // Pacific
  'ANA': { primary: '#F47A38', secondary: '#B9975B' }, // Ducks
  'CGY': { primary: '#C8102E', secondary: '#F1BE48' }, // Flames
  'EDM': { primary: '#041E42', secondary: '#FF4C00' }, // Oilers
  'LA': { primary: '#111111', secondary: '#A2AAAD' },  // Kings
  'LAK': { primary: '#111111', secondary: '#A2AAAD' },  // Kings (alias)
  'SJ': { primary: '#006D75', secondary: '#000000' },  // Sharks
  'SJS': { primary: '#006D75', secondary: '#000000' },  // Sharks (alias)
  'SEA': { primary: '#001628', secondary: '#99D9D9' }, // Kraken
  'VAN': { primary: '#001F5B', secondary: '#00843D' }, // Canucks
  'VGK': { primary: '#B4975A', secondary: '#333F42' }, // Golden Knights
  'VGS': { primary: '#B4975A', secondary: '#333F42' }, // Golden Knights (alias)
};

// Calculate luminance of a hex color (0-1 scale, 0 = darkest, 1 = brightest)
function getColorLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  // Relative luminance formula (ITU-R BT.709)
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
}

// Convert hex to RGB
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

// Lighten a hex color by a percentage (0-100)
function lightenColor(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  const factor = percent / 100;
  const r = Math.min(255, Math.round(rgb.r + (255 - rgb.r) * factor));
  const g = Math.min(255, Math.round(rgb.g + (255 - rgb.g) * factor));
  const b = Math.min(255, Math.round(rgb.b + (255 - rgb.b) * factor));

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
}

// Enhance dark colors to make them more visible on dark backgrounds
// This ensures both teams' colors are balanced and visible
function enhanceDarkColor(color: string): string {
  const luminance = getColorLuminance(color);

  // If the color is very dark (luminance < 0.15), brighten it
  // The darker the color, the more we lighten it
  if (luminance < 0.08) {
    // Extremely dark (near black) - lighten significantly
    return lightenColor(color, 45);
  } else if (luminance < 0.12) {
    // Very dark - lighten moderately
    return lightenColor(color, 35);
  } else if (luminance < 0.18) {
    // Dark - lighten slightly
    return lightenColor(color, 25);
  }

  return color;
}

// Helper function to get team colors by abbreviation and sport
// Automatically enhances dark colors to ensure visibility
// espnColor is the color from ESPN API, used as fallback for teams not in our color map
export function getTeamColors(abbreviation: string, sport: Sport, espnColor?: string): TeamColors {
  // Use more visible default colors instead of dark gray
  const defaultColors: TeamColors = { primary: '#5A7A8A', secondary: '#FFFFFF' };

  let colors: TeamColors | undefined;
  switch (sport) {
    case Sport.NFL:
      colors = NFL_TEAM_COLORS[abbreviation];
      break;
    case Sport.NCAAF:
      colors = NCAAF_TEAM_COLORS[abbreviation] ?? NFL_TEAM_COLORS[abbreviation];
      break;
    case Sport.NBA:
      colors = NBA_TEAM_COLORS[abbreviation];
      break;
    case Sport.NCAAB:
      colors = NCAAB_TEAM_COLORS[abbreviation] ?? NBA_TEAM_COLORS[abbreviation];
      break;
    case Sport.MLB:
      colors = MLB_TEAM_COLORS[abbreviation];
      break;
    case Sport.NHL:
      colors = NHL_TEAM_COLORS[abbreviation];
      break;
    case Sport.MLS:
      colors = MLS_TEAM_COLORS[abbreviation];
      break;
    case Sport.EPL:
      colors = EPL_TEAM_COLORS[abbreviation];
      break;
    default:
      colors = undefined;
  }

  // If colors weren't found, use ESPN color if available, otherwise default
  if (!colors) {
    if (espnColor && espnColor !== '#000000') {
      // Use ESPN color as primary and white as secondary
      colors = { primary: espnColor.startsWith('#') ? espnColor : `#${espnColor}`, secondary: '#FFFFFF' };
    } else {
      colors = defaultColors;
    }
  }

  // Enhance dark colors so they're visible on dark card backgrounds
  return {
    primary: enhanceDarkColor(colors.primary),
    secondary: enhanceDarkColor(colors.secondary),
  };
}
