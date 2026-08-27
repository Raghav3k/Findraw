export type ArtistPackKind = "general" | "game";

export type ArtistWord = {
  answer: string;
  aliases?: string[];
};

export type ArtistWordPack = {
  id: string;
  label: string;
  description: string;
  kind: ArtistPackKind;
  icon: string;
  accent: string;
  words: ArtistWord[];
};

export type ArtistWordMix = {
  kind: ArtistPackKind;
  packIds: string[];
};

export type ArtistPackPrompt = ArtistWord & {
  categoryId: string;
  difficulty: "easy";
};

export const GENERAL_MIXED_PACK_ID = "general-mixed";
export const DEFAULT_ARTIST_WORD_MIX: ArtistWordMix = { kind: "general", packIds: [GENERAL_MIXED_PACK_ID] };

const words = (...answers: string[]): ArtistWord[] => answers.map((answer) => ({ answer }));

export const ARTIST_WORD_PACKS: ArtistWordPack[] = [
  {
    id: "general-animals",
    label: "Animals",
    description: "Familiar pets, wildlife and sea animals.",
    kind: "general",
    icon: "pets",
    accent: "#df9a62",
    words: words(
      "Dog", "Cat", "Elephant", "Giraffe", "Lion", "Tiger", "Monkey", "Rabbit", "Horse", "Panda",
      "Penguin", "Bear", "Zebra", "Kangaroo", "Owl", "Turtle", "Peacock", "Crocodile", "Dolphin", "Whale",
      "Shark", "Octopus", "Jellyfish", "Seahorse", "Starfish", "Crab", "Lobster", "Seal", "Flamingo", "Koala",
    ),
  },
  {
    id: "general-food",
    label: "Food",
    description: "Everyday meals, snacks, fruit and drinks.",
    kind: "general",
    icon: "restaurant",
    accent: "#ed8b67",
    words: words(
      "Pizza", "Taco", "Noodles", "Watermelon", "Cupcake", "Ice Cream", "Pineapple", "Donut", "Burrito", "Dumpling",
      "Pretzel", "Waffle", "Nachos", "Banana", "Strawberry", "Popcorn", "Potato Chips", "Cereal Bowl", "Pancakes", "Toast",
      "Fried Egg", "Brownie", "Coffee", "Tea", "Milkshake", "Lemonade", "Smoothie", "Hot Chocolate", "Sandwich", "Birthday Cake",
    ),
  },
  {
    id: "general-places",
    label: "Places",
    description: "Recognizable places, buildings and landmarks.",
    kind: "general",
    icon: "travel_explore",
    accent: "#80b58c",
    words: words(
      "Beach", "School", "Hospital", "Airport", "Library", "Museum", "Zoo", "Stadium", "Train Station", "Amusement Park",
      "Lighthouse", "Castle", "Waterfall", "Volcano", "Treehouse", "Skyscraper", "Bridge", "Igloo", "Aquarium", "Harbor",
      "Eiffel Tower", "Pyramid", "Big Ben", "Taj Mahal", "Great Wall of China", "Golden Gate Bridge", "Sydney Opera House", "Windmill",
    ),
  },
  {
    id: "general-screen",
    label: "Movies & TV",
    description: "Popular characters, shows and movie icons.",
    kind: "general",
    icon: "movie",
    accent: "#7b9ac8",
    words: words(
      "Spider-Man", "Batman", "Superman", "Iron Man", "The Avengers", "Star Wars", "Death Star", "Frozen", "Toy Story", "The Lion King",
      "Shrek", "Finding Nemo", "Minions", "SpongeBob", "Kung Fu Panda", "Jurassic Park", "Titanic", "Barbie", "Home Alone", "Ghostbusters",
      "Stranger Things", "The Simpsons", "Jaws", "King Kong", "Indiana Jones", "Pirates of the Caribbean",
    ),
  },
  {
    id: "general-music",
    label: "Music",
    description: "Common instruments, performance and famous songs.",
    kind: "general",
    icon: "music_note",
    accent: "#bb83c8",
    words: words(
      "Guitar", "Piano", "Drum Kit", "Microphone", "Headphones", "Violin", "Trumpet", "Harp", "Saxophone", "Maracas",
      "Banjo", "Accordion", "Tambourine", "Cello", "Trombone", "Flute", "Ukulele", "Cymbal", "Xylophone", "Sitar",
      "Happy Birthday", "Baby Shark", "Let It Go", "Thriller", "Gangnam Style",
    ),
  },
  {
    id: "general-sports",
    label: "Sports",
    description: "Popular sports, equipment and activities.",
    kind: "general",
    icon: "sports_soccer",
    accent: "#6ca2d1",
    words: words(
      "Football", "Basketball", "Cricket Bat", "Tennis Racket", "Skateboard", "Boxing Gloves", "Swimming", "Golf", "Volleyball", "Surfboard",
      "Hockey Stick", "Trophy", "Scoreboard", "Badminton", "Table Tennis", "Baseball Glove", "Bowling Ball", "Racing Car", "Skiing", "Archery",
      "Fencing", "Gymnastics",
    ),
  },
  {
    id: "general-everyday",
    label: "Everyday",
    description: "Simple objects, rooms, clothing and actions.",
    kind: "general",
    icon: "inventory_2",
    accent: "#a6a083",
    words: words(
      "Umbrella", "Alarm Clock", "Backpack", "Toothbrush", "Coffee Mug", "Shopping Cart", "Sunglasses", "Suitcase", "Water Bottle", "Remote Control",
      "Desk Lamp", "Key", "Chair", "Spoon", "Plate", "Fork", "Pillow", "Mirror", "Vacuum Cleaner", "Running",
      "Sleeping", "Dancing", "Cooking", "Reading", "Singing", "Jumping", "Painting", "Hat", "Shoes", "Bedroom",
    ),
  },
  {
    id: "general-nature",
    label: "Nature",
    description: "Weather, landscapes, plants and outdoor scenes.",
    kind: "general",
    icon: "forest",
    accent: "#76ad76",
    words: words(
      "Rainbow", "Cloud", "Thunderstorm", "Snowman", "Sun", "Moon", "Mountain", "River", "Forest", "Desert",
      "Island", "Cave", "Flower", "Tree", "Cactus", "Palm Tree", "Mushroom", "Campfire", "Tent", "Waterfall",
      "Tornado", "Snowflake", "Volcano", "Sunflower", "Leaf",
    ),
  },
  {
    id: "game-minecraft",
    label: "Minecraft",
    description: "Iconic mobs, tools and places casual players know.",
    kind: "game",
    icon: "grass",
    accent: "#91bd74",
    words: words(
      "Creeper", "Zombie", "Enderman", "Diamond", "Crafting Table", "Torch", "Villager", "Pig", "Minecart", "Nether Portal",
      "TNT", "Bed", "Chest", "Diamond Sword", "Fishing Rod", "Ender Dragon", "Axolotl", "Elytra", "Beehive", "Ender Pearl",
      "Iron Golem", "Skeleton", "Pickaxe", "Redstone", "Potion",
    ),
  },
  {
    id: "game-valorant",
    label: "Valorant",
    description: "Recognizable agents, weapons, maps and abilities.",
    kind: "game",
    icon: "my_location",
    accent: "#e88f9a",
    words: words(
      "Spike", "Vandal", "Phantom", "Operator", "Sheriff", "Jett", "Sage", "Phoenix", "Omen", "Brimstone",
      "Cypher", "Sova", "Raze", "Killjoy", "Reyna", "Chamber", "Yoru", "Ascent", "Bind", "Haven",
      "Icebox", "Split", "Recon Bolt", "Boom Bot", "Resurrection",
    ),
  },
  {
    id: "game-fortnite",
    label: "Fortnite",
    description: "Classic items, characters and match moments.",
    kind: "game",
    icon: "fort",
    accent: "#8fb7e8",
    words: words(
      "Battle Bus", "Loot Llama", "Victory Royale", "Glider", "Shield Potion", "Storm Circle", "Treasure Chest", "Reboot Van", "Medkit", "Emote",
      "Back Bling", "Supply Drop", "V-Bucks", "Battle Pass", "Peely", "Jonesy", "Durr Burger", "Launch Pad", "Boogie Bomb", "Chug Jug",
      "Shockwave Grenade", "Reboot Card", "Slurp Juice", "Grappler", "Crash Pad",
    ),
  },
  {
    id: "game-league",
    label: "League of Legends",
    description: "Famous champions, objectives and match basics.",
    kind: "game",
    icon: "shield",
    accent: "#c6ad78",
    words: words(
      "Ahri", "Garen", "Lux", "Jinx", "Teemo", "Yasuo", "Annie", "Ashe", "Thresh", "Miss Fortune",
      "Baron Nashor", "Dragon", "Turret", "Nexus", "Ward", "Minion", "Recall", "Flash", "Summoner's Rift", "Blue Buff",
      "Red Buff", "Pentakill", "Health Potion", "Treasure Hunter", "Poros",
    ),
  },
  {
    id: "game-gta",
    label: "Grand Theft Auto V",
    description: "Characters, vehicles and familiar Los Santos moments.",
    kind: "game",
    icon: "directions_car",
    accent: "#d6aa6f",
    words: words(
      "Michael", "Franklin", "Trevor", "Los Santos", "Wanted Level", "Police Car", "Helicopter", "Sports Car", "Motorcycle", "Parachute",
      "Heist", "Getaway Car", "Safehouse", "Taxi", "Tow Truck", "Submarine", "Jet Ski", "Golf Club", "Mask", "Money Bag",
    ),
  },
  {
    id: "game-deadlock",
    label: "Deadlock",
    description: "Heroes, lanes, objectives and items Deadlock players recognize.",
    kind: "game",
    icon: "adjust",
    accent: "#b4a0d6",
    words: words(
      "Abrams", "Bebop", "Dynamo", "Grey Talon", "Haze", "Infernus", "Ivy", "Kelvin", "Lady Geist", "McGinnis",
      "Mo and Krill", "Pocket", "Seven", "Vindicta", "Warden", "Yamato", "Zipline", "Soul Urn", "Patron", "Guardian",
      "Walker", "Mid Boss", "Golden Statue", "Rejuvenator", "Hook", "Flame Dash",
    ),
  },
  {
    id: "game-clash-royale",
    label: "Clash Royale",
    description: "Famous troops, towers, spells and arena objects.",
    kind: "game",
    icon: "crown",
    accent: "#d9b66f",
    words: words(
      "King Tower", "Princess Tower", "Crown", "Elixir", "Chest", "Arena", "Hog Rider", "Mega Knight", "Mini P.E.K.K.A", "Skeleton Army",
      "Goblin Barrel", "Baby Dragon", "Balloon", "Valkyrie", "Wizard", "Witch", "Knight", "Archers", "Giant", "Miner",
      "Prince", "Electro Wizard", "Royal Giant", "X-Bow", "Cannon", "Fireball", "The Log", "Rocket",
    ),
  },
  {
    id: "game-clash-of-clans",
    label: "Clash of Clans",
    description: "Classic troops, buildings, resources and spells.",
    kind: "game",
    icon: "castle",
    accent: "#d69b72",
    words: words(
      "Town Hall", "Barbarian", "Archer", "Giant", "Goblin", "Wizard", "Dragon", "Wall Breaker", "Balloon", "Healer",
      "P.E.K.K.A", "Hog Rider", "Bowler", "Witch", "Miner", "Cannon", "Mortar", "Archer Tower", "Wizard Tower", "Clan Castle",
      "Gold Mine", "Elixir Collector", "Dark Elixir", "Wall", "Builder Hut", "Rage Spell", "Freeze Spell", "Lightning Spell",
    ),
  },
  {
    id: "game-rainbow-six-siege",
    label: "Rainbow Six Siege",
    description: "Well-known operators, equipment and match basics.",
    kind: "game",
    icon: "door_open",
    accent: "#8fa9b8",
    words: words(
      "Drone", "Reinforcement", "Defuser", "Sledge", "Thermite", "Ash", "Twitch", "Rook", "Mute", "Frost",
      "Valkyrie", "Echo", "Kapkan", "Castle", "Pulse", "Fuze", "Smoke", "Bandit", "Breach Charge", "Barricade",
      "Shield", "Camera", "Barbed Wire", "Rotation Hole", "Spawn Peek", "Hostage",
    ),
  },
  {
    id: "game-dota-2",
    label: "Dota 2",
    description: "Iconic heroes, items, creatures and objectives.",
    kind: "game",
    icon: "swords",
    accent: "#bd746a",
    words: words(
      "Pudge", "Juggernaut", "Crystal Maiden", "Axe", "Sniper", "Invoker", "Phantom Assassin", "Lina", "Roshan", "Aegis",
      "Courier", "Tower", "Ancient", "Creep", "Rune", "Ward", "Blink Dagger", "Black King Bar", "Tango", "Bottle",
      "Divine Rapier", "Smoke", "Gem", "Fountain", "Barracks", "Teamfight",
    ),
  },
  {
    id: "game-arc-raiders",
    label: "ARC Raiders",
    description: "Raiders, ARC machines, loot and extraction essentials.",
    kind: "game",
    icon: "robot_2",
    accent: "#a98e72",
    words: words(
      "Raider", "ARC", "Rust Belt", "Speranza", "Topside", "Workshop", "Raider Hatch", "Extraction", "Backpack", "Shield",
      "Medkit", "Grenade", "Zipline", "Loot", "Drone", "Tick", "Wasp", "Hornet", "Leaper", "Bastion",
      "Rocketeer", "Surveyor", "Queen", "Blueprint", "Scrappy", "Raider Den",
    ),
  },
  {
    id: "game-genshin-impact",
    label: "Genshin Impact",
    description: "Popular characters, creatures, currency and landmarks.",
    kind: "game",
    icon: "temp_preferences_custom",
    accent: "#91b8d3",
    words: words(
      "Paimon", "Traveler", "Amber", "Kaeya", "Lisa", "Diluc", "Venti", "Klee", "Zhongli", "Raiden Shogun",
      "Nahida", "Furina", "Slime", "Hilichurl", "Seelie", "Statue of The Seven", "Mora", "Primogem", "Vision", "Glider",
      "Teleport Waypoint", "Treasure Chest", "Anemo", "Geo", "Electro", "Domain",
    ),
  },
  {
    id: "game-deep-rock-galactic",
    label: "Deep Rock Galactic",
    description: "Dwarves, cave creatures, minerals and co-op essentials.",
    kind: "game",
    icon: "hardware",
    accent: "#d7a349",
    words: words(
      "Dwarf", "Molly", "Bosco", "Glyphid", "Loot Bug", "Morkite", "Gold", "Nitra", "Red Sugar", "Pickaxe",
      "Flare", "Drop Pod", "Supply Pod", "Engineer", "Scout", "Gunner", "Driller", "Cave Leech", "Bulk Detonator", "Dreadnought",
      "Beer Mug", "Mushroom", "Rock and Stone", "Zipline", "Turret",
    ),
  },
  {
    id: "game-risk-of-rain-2",
    label: "Risk of Rain 2",
    description: "Survivors, monsters and items regular players know.",
    kind: "game",
    icon: "thunderstorm",
    accent: "#8fb0cb",
    words: words(
      "Commando", "Huntress", "Engineer", "Loader", "Captain", "Railgunner", "Acrid", "MUL-T", "Teleporter", "Shrine",
      "Chest", "Drone", "Lunar Coin", "Ukulele", "Teddy Bear", "Crowbar", "Goat Hoof", "Energy Drink", "Golem", "Beetle",
      "Lemurian", "Jellyfish", "Artifact", "Void Cradle", "Escape Pod",
    ),
  },
  {
    id: "game-hunt-showdown",
    label: "Hunt: Showdown 1896",
    description: "Monsters, tools and bounty-hunt essentials.",
    kind: "game",
    icon: "skull",
    accent: "#927861",
    words: words(
      "Hunter", "Bounty", "Clue", "Boss", "Butcher", "Spider", "Assassin", "Scrapbeak", "Hellhound", "Hive",
      "Meathead", "Grunt", "Extraction", "Lantern", "Bear Trap", "Revolver", "Shotgun", "Crossbow", "Dynamite", "First Aid Kit",
      "Concertina Wire", "Dark Sight", "Compound", "Crow", "Horse",
    ),
  },
  {
    id: "game-brawlhalla",
    label: "Brawlhalla",
    description: "Popular legends, weapons and arena items.",
    kind: "game",
    icon: "sports_martial_arts",
    accent: "#8d9ed0",
    words: words(
      "Bodvar", "Cassidy", "Orion", "Hattori", "Ada", "Brynn", "Koji", "Nix", "Mordex", "Rayman",
      "Axe", "Sword", "Hammer", "Spear", "Bow", "Blasters", "Gauntlets", "Scythe", "Cannon", "Orb",
      "Greatsword", "Bomb", "Spike Ball", "Horn", "Platform", "Stock",
    ),
  },
];

export const ARTIST_GENERAL_PACKS = ARTIST_WORD_PACKS.filter((pack) => pack.kind === "general");
export const ARTIST_GAME_PACKS = ARTIST_WORD_PACKS.filter((pack) => pack.kind === "game");

const packById = new Map(ARTIST_WORD_PACKS.map((pack) => [pack.id, pack]));

export function normalizeArtistWordMix(mix?: Partial<ArtistWordMix> | null): ArtistWordMix {
  const kind: ArtistPackKind = mix?.kind === "game" ? "game" : "general";
  const validIds = [...new Set(mix?.packIds ?? [])].filter((id) => packById.get(id)?.kind === kind);
  if (kind === "general" && (mix?.packIds?.includes(GENERAL_MIXED_PACK_ID) || validIds.length === 0)) {
    return { kind, packIds: [GENERAL_MIXED_PACK_ID] };
  }
  if (kind === "game" && validIds.length === 0) return { kind: "general", packIds: [GENERAL_MIXED_PACK_ID] };
  return { kind, packIds: validIds };
}

export function getArtistMixPacks(mix: ArtistWordMix): ArtistWordPack[] {
  const normalized = normalizeArtistWordMix(mix);
  if (normalized.kind === "general" && normalized.packIds.includes(GENERAL_MIXED_PACK_ID)) return ARTIST_GENERAL_PACKS;
  return normalized.packIds.flatMap((id) => packById.get(id) ?? []);
}

export function getArtistMixLabel(mix: ArtistWordMix) {
  const normalized = normalizeArtistWordMix(mix);
  if (normalized.kind === "general" && normalized.packIds.includes(GENERAL_MIXED_PACK_ID)) return "General Mix";
  const labels = getArtistMixPacks(normalized).map((pack) => pack.label);
  if (labels.length <= 3) return labels.join(" + ");
  return `${labels.slice(0, 2).join(" + ")} + ${labels.length - 2} more`;
}

export function getArtistMixWordCount(mix: ArtistWordMix) {
  return new Set(getArtistMixPacks(mix).flatMap((pack) => pack.words.map((word) => word.answer.toLocaleLowerCase("en")))).size;
}

export function getArtistMixSamples(mix: ArtistWordMix, count = 6) {
  const packs = getArtistMixPacks(mix);
  const samples: ArtistWord[] = [];
  let index = 0;
  while (samples.length < count && packs.some((pack) => pack.words[index])) {
    packs.forEach((pack) => {
      const word = pack.words[index];
      if (word && samples.length < count && !samples.some((item) => item.answer === word.answer)) samples.push(word);
    });
    index += 1;
  }
  return samples;
}

export const getArtistPromptKey = (prompt: ArtistPackPrompt) => `${prompt.categoryId}:${prompt.answer.toLocaleLowerCase("en")}`;

export function pickArtistPrompt(mix: ArtistWordMix, recentKeys: string[]): ArtistPackPrompt {
  const packs = getArtistMixPacks(mix);
  const recent = new Set(recentKeys.slice(-32));
  const recentPackIds = recentKeys.slice(-Math.max(4, packs.length * 2)).map((key) => key.split(":")[0]);
  const packCounts = new Map(packs.map((pack) => [pack.id, recentPackIds.filter((id) => id === `pack-${pack.id}`).length]));
  const minimumCount = Math.min(...packCounts.values());
  const balancedPacks = packs.filter((pack) => packCounts.get(pack.id) === minimumCount);
  const pack = balancedPacks[Math.floor(Math.random() * balancedPacks.length)] ?? packs[0];
  const available = pack.words.filter((word) => !recent.has(`pack-${pack.id}:${word.answer.toLocaleLowerCase("en")}`));
  const choices = available.length > 0 ? available : pack.words;
  const word = choices[Math.floor(Math.random() * choices.length)] ?? { answer: "Dog" };
  return { ...word, categoryId: `pack-${pack.id}`, difficulty: "easy" };
}
