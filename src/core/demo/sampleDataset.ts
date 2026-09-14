import type { NativeWorldInfoEntry } from '../../global';

export interface WiRootSettingsMock {
    bookName: string;
    scanDepthOverride: number;
    caseSensitiveOverride: boolean;
    recursiveScanning: boolean;
    notes: string;
}

export interface SampleFolderNode {
    id: string;
    parentId: string | null;
    kind: 'folder';
    name: string;
    isWiRoot: boolean;
    wiSettings: WiRootSettingsMock | null;
    expanded: boolean;
    children: SampleNode[];
}

export interface SampleEntryNode {
    id: string;
    parentId: string;
    kind: 'entry';
    name: string;
    fields: NativeWorldInfoEntry;
    bookMemberships: string[];
    contentLengthClass: 'normal' | 'long';
}

export interface SampleImageNode {
    id: string;
    parentId: string;
    kind: 'image';
    name: string;
    source: string;
    caption: string;
}

export type SampleNode = SampleFolderNode | SampleEntryNode | SampleImageNode;

export interface SampleDataset {
    meta: {
        title: string;
        prototypeLabel: string;
    };
    root: SampleFolderNode;
}

type EntryDefaults = Omit<
    NativeWorldInfoEntry,
    'uid' | 'key' | 'comment' | 'content' | 'displayIndex' | 'extensions'
>;

const ENTRY_DEFAULTS: EntryDefaults = {
    keysecondary: [],
    constant: false,
    vectorized: false,
    selective: true,
    selectiveLogic: 0,
    probability: 100,
    useProbability: true,
    disable: false,
    order: 100,
    position: 0,
    depth: 4,
    role: 0,
    outletName: '',
    ignoreBudget: false,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: 0,
    matchPersonaDescription: false,
    matchCharacterDescription: false,
    matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false,
    matchScenario: false,
    matchCreatorNotes: false,
    group: '',
    groupOverride: false,
    groupWeight: 100,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    sticky: null,
    cooldown: null,
    delay: null,
    automationId: '',
    triggers: [],
    characterFilterNames: [],
    characterFilterTags: [],
    characterFilterExclude: false,
    addMemo: true,
};

interface EntrySeed {
    id: string;
    parentId: string;
    name: string;
    uid: number;
    keys: string[];
    content: string;
    bookMemberships?: string[];
    contentLengthClass?: 'normal' | 'long';
    fields?: Partial<NativeWorldInfoEntry>;
}

function makeEntry(seed: EntrySeed): SampleEntryNode {
    const fields: NativeWorldInfoEntry = {
        ...ENTRY_DEFAULTS,
        uid: seed.uid,
        comment: seed.name,
        content: seed.content,
        key: [...seed.keys],
        ...seed.fields,
    };
    fields.displayIndex = fields.displayIndex ?? seed.uid;
    fields.extensions = fields.extensions ?? {};
    return {
        id: seed.id,
        parentId: seed.parentId,
        kind: 'entry',
        name: seed.name,
        fields,
        bookMemberships: seed.bookMemberships ?? [],
        contentLengthClass: seed.contentLengthClass ?? 'normal',
    };
}

function makeImage(
    id: string,
    parentId: string,
    name: string,
    caption: string,
    source: string
): SampleImageNode {
    return { id, parentId, kind: 'image', name, source, caption };
}

interface FolderSeed {
    id: string;
    parentId: string | null;
    name: string;
    isWiRoot?: boolean;
    wiSettings?: WiRootSettingsMock;
    expanded?: boolean;
    children: SampleNode[];
}

function makeFolder(seed: FolderSeed): SampleFolderNode {
    return {
        id: seed.id,
        parentId: seed.parentId,
        kind: 'folder',
        name: seed.name,
        isWiRoot: seed.isWiRoot ?? false,
        wiSettings: seed.wiSettings ?? null,
        expanded: seed.expanded ?? false,
        children: seed.children,
    };
}

const MAP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><rect width="320" height="200" fill="#e7ecdf"/><path d="M15 45 C 90 65, 170 30, 305 75" stroke="#5a8bb0" stroke-width="7" fill="none"/><path d="M10 155 C 110 135, 210 175, 312 140" stroke="#4f7d9e" stroke-width="7" fill="none"/><circle cx="148" cy="56" r="6" fill="#a33d3d"/><text x="156" y="61" font-size="12" fill="#333">Bristlemark</text><rect x="235" y="105" width="26" height="26" fill="#6b6b6b"/><text x="212" y="150" font-size="12" fill="#333">Cinderfall Watch</text><text x="12" y="25" font-size="14" fill="#333">Aldermeer - sketch</text></svg>`;

const TOWER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="240" viewBox="0 0 180 240"><rect width="180" height="240" fill="#dcd8d0"/><rect x="70" y="70" width="40" height="150" fill="#6e6a63"/><rect x="62" y="58" width="56" height="16" fill="#57544e"/><polygon points="62,58 90,20 118,58" fill="#8a5a3b"/><circle cx="90" cy="44" r="7" fill="#e0a83c"/><text x="24" y="232" font-size="12" fill="#333">Cinderfall Watch</text></svg>`;

function svgToDataUri(svg: string): string {
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const REALM_BOOK = 'aldermeer-realm';
const MARCHES_BOOK = 'ashen-marches';

const REALM_OVERVIEW_CONTENT = [
    'Aldermeer is a river realm of moderate size, wedged between two old kingdoms that have each, at one time or another, claimed it as a province. It has never been large enough to command attention and never small enough to be forgotten. The realm takes its shape from water: the Lira runs down from the northern fells, the Ossen crawls out of the western moors, and the two meet at the capital, Bristlemark, before draining together into the Reedy Sea. Everything in Aldermeer is measured, priced, and remembered by its distance from those rivers. Farms pay their rents in grain moved by barge, guilds set their tolls at the bridges, and the oldest families keep their names tied to the fords their ancestors once held.',
    'The land between the rivers, the Lowlands, is the realm\'s kitchen and its purse. It is a country of hedged fields, drained meadows, and slow canals, broken every few miles by a market village and every dozen miles by a walled town. Wheat, barley, flax, and hops grow well in the silt; the terraced slopes near the fells carry orchards and vine rows of no great distinction but honest yield. The Lowlanders are famous for their patience. Their proverbs run long, their lawsuits run longer, and their dikes, maintained by compulsory communal labor twice a year, have held for eleven generations. A visitor learns quickly that in the Lowlands the worst insult is not a curse but a shrug: the flat, patient look of a farmer deciding whether you are worth the trouble of an argument.',
    'To the east the land climbs into the Verdant Span, a broad belt of old growth that has never been fully mapped, much less tamed. The Span is Aldermeer\'s timber store, its hunting ground, its refuge in bad years, and its graveyard in worse ones. Charcoal burners, resin tappers, and honey hunters work its margins under licenses sold by the crown, and every one of them observes the same rule: be out of the deep woods before the evening mist. The rule is older than any current law, and though scholars in Bristlemark dismiss the reasons as superstition, the woodsmen do not. Enough parties have gone in after stragglers and come back one member short, quiet and unwilling to describe what they saw, to keep the custom alive without any enforcement at all.',
    'The far side of the Span, running north and south in a ragged line of hills, is the Ashen Marches, so named for the volcanic soil that greys the fields there and for the cinder-pale roads that carry what little trade crosses the border. The Marches are Aldermeer\'s frontier in every sense. Raiding bands came over those hills for two centuries; the watchtowers that sprang up against them are now mostly granaries and gallows, but the habit of vigilance remains. The marcher lords hold their land directly from the crown on terms older than the capital\'s law codes, and they behave accordingly: proud, prickly, charitable to travelers, and utterly indifferent to the opinions of the river towns. Vesk Harrow, the present Lord of the Marches, is said to keep the old border oath framed above his hearth, and to read it aloud each year on the night the beacons are tested.',
    'Bristlemark, the capital, stands on the confluence and is built, in the honest description of its own chroniclers, on barges, pilings, and pride. Its heart is the Bridgehold, the fortified span where the Lira and Ossen meet, around which the city climbs in terraces of grey stone and whitewashed timber. The harbor district never sleeps; grain, wool, smoked fish, resin, and iron come down the rivers, and silk, salt, dyes, and rumor go up them. The city\'s second industry, after shipping, is paperwork: every barge, every toll, every dike levy and guild fine is recorded in the Bridgehold archives, a trove of vellum and habit that scholars from both neighboring kingdoms have offered frankly ridiculous sums to copy. The archivists refuse, politely, forever.',
    'The people of Aldermeer are of three old stocks that have intermarried until the seams show mostly in surnames. Riverborn families of the Lowlands prize land, ledger, and legacy; they marry late, buy early, and consider a debt unpaid after harvest a stain on the house. Fellborn families of the north and east prize flock, fire, and friendship; they take offense quickly, forgive slowly, and count hospitality as a debt of honor. Marchborn families of the frontier, never numerous, prize watchfulness above all; they greet strangers kindly, feed them first, and question them thoroughly afterward. Three centuries of shared wars and shared markets have rubbed the stocks into a single people with three temperaments, and a visitor who learns to read which temperament a face carries has learned most of what matters about local politics.',
    'Governance in Aldermeer is a bargained thing. The crown sits in Bristlemark and collects the great tolls, mints the coin, and keeps the archives, but it governs the Lowlands through the Dike Courts, the Span through licensed wardens, and the Marches through the marcher lords\' own assizes. Twice a year the Stewards\' Moot convenes at the Bridgehold: the crown\'s stewards, the dike reeves, the warden-captains, and the marcher lords argue rates, repairs, and boundaries until they agree or run out of wine. The Moot\'s real product is not law but the yearly price of agreement, and everyone in the hall knows it. Decisions there are kept, because every faction has already paid for them in concessions, and an agreement nobody paid for is regarded as a draft.',
    'The Gilded Circle, the merchant consortium of Bristlemark, is the closest thing the realm has to a second government. Formally it is a guild of shipping houses; practically it is a lending desk, an intelligence service, and a foreign policy all in one. The Circle financed the rebuilding of the Bridgehold after the fire year, and it has never let the crown forget the favor. Its factors keep books in every market town and its couriers ride faster than the crown\'s. The Circle\'s one public rule, posted in its counting hall, is that it lends on cargo, never on crowns, and the rule has kept it wealthy through three wars in which both neighboring kingdoms came asking. What the Circle wants, usually, is predictability: open bridges, honest weights, and no Taxes New.',
    'The Order of the Quiet Flame is Aldermeer\'s native contemplative tradition, and it is neither a church nor a cult but something the realm finds easier to house than to describe. Its houses, called hearthhalls, stand in every town: plain buildings with a central lamp that is never let to die. The Flamekeepers take no vows of silence and own nothing beyond a grey coat and a lamp key; they keep the lamps, tend the sick, sit with the dying, and record, in the hall\'s daybook, one honest sentence about each day. The daybooks, spanning four centuries, have become the realm\'s most trusted chronicle precisely because the Flamekeepers take no side. When two great houses dispute an old boundary, both eventually send a clerk to the hearthhall of the place in question, to read what the lamp saw.',
    'The realm\'s calendar is agricultural, riverine, and stubbornly local. The year opens with the Thaw Reckoning, when the ice breaks on the Lira and the first barges load; the date moves, so the festival does too, and children race the ice floes along the embankments for coins. High summer brings the Dike Walk, the communal inspection of every floodwall, part audit and part picnic, ending in lanterns set adrift at the confluence. Autumn\'s Stamp Night closes the grain ledgers in a single uproarious evening of countersigning, toasts, and spectacularly bad arithmetic songs. The winter solstice is kept quietly as Lamp Night, when every hearthhall admits the whole town and the Flamekeepers read, aloud, the single sentence recorded on that date one hundred years before.',
    'Folklore in Aldermeer clusters around crossings. Bridges, fords, and ferry-stages are the thresholds where the realm\'s polite, practical imagination places its wonders and its warnings. The Bridge Ward is said to walk the span on misty nights, weighing the traffic of the day and pausing at the name of anyone who passed unjustly. The Verdant Span\'s evening mist is held to be a border of its own kind, and the woodmen\'s rule about it is taught as etiquette rather than fear. In the Marches, the beacons are never allowed to fully die, and the old oath holds that while one tower keeps its coals, the border holds too. Whether any of this is true is, to Aldermeer\'s own mind, the wrong question; the customs are load-bearing, and the realm maintains its legends the way it maintains its dikes.',
    'Roads and trade knit the realm together and define its moods. The Stonecord, the great causeway from Bristlemark through the Lowlands to the southern ferry, is wide, patrolled, and dull, and Aldermeer loves it. The Pale Roads through the Marches are older, narrower, and pale with volcanic dust; they are safe by marcher law and eerie by common report, and caravans on them keep a running conversation going for no reason anyone admits. River traffic sets the rhythm of the year, and the barge families are a trade nobility of their own, reading water the way scholars read archives. Smuggling exists, of course, chiefly in untaxed resin and unlicensed hemp, and the Crown Wardens pursue it with the unhurried diligence of people who know the rivers will deliver the smugglers to them eventually.',
    'The realm\'s present tensions are three, and every tavern keeps its own ranking of them. First is the toll question: the Circle\'s shipping houses and the crown\'s stewards have been circling the Bridgehold rates for a decade, and the Stewards\' Moot has twice ended with the wine left standing. Second is the Marches question: Bristlemark\'s lawyers keep discovering that the border oath obliges the crown to maintain the beacon towers, and the marcher lords keep, very politely, presenting the bill. Third, quietest and oldest, is the Span question: the charcoal licenses sold every year press a little deeper into the old growth, the woodmen\'s customs press back, and each side watches the other across a line nobody has ever needed to draw on a map.',
    'For a traveler, Aldermeer is easy to enter and hard to leave, in the affectionate sense. The inns are clean, the tolls are posted, the weights are honest, and the conversation is meticulous. Guests are asked three questions in the same order everywhere: where from, where to, and what news of the roads; the answers are remembered longer than the guest. What the realm asks in return is small and nonnegotiable: keep your bargains, mind the water, respect the mist, and leave the ledgers alone. Those who do are remembered fondly in the daybooks. Those who do not become, in time, a single honest sentence in some hearthhall\'s book, which is the closest thing Aldermeer has to a judgment and the only one it has never once appealed.',
    'At a glance, for the quick reference of any chronicler: capital, Bristlemark, at the confluence; chief rivers, the Lira and the Ossen; regions, the Lowlands, the Verdant Span, the Ashen Marches, and the northern fells; powers, the crown at the Bridgehold, the Gilded Circle at the counting hall, the marcher lords at their assizes, and the Flamekeepers in their hearthhalls; yearly hinges, the Thaw Reckoning, the Dike Walk, Stamp Night, and Lamp Night; standing warnings, be off the deep woods before the evening mist, keep one tower burning on the border, and never, under any treaty or temptation, lend on crowns.',
].join('\n\n');

const tree: SampleFolderNode = makeFolder({
    id: 'workspace-root',
    parentId: null,
    name: 'Aldermeer Workspace',
    expanded: true,
    children: [
        makeFolder({
            id: 'realm-root',
            parentId: 'workspace-root',
            name: 'Realm of Aldermeer',
            isWiRoot: true,
            wiSettings: {
                bookName: REALM_BOOK,
                scanDepthOverride: 3,
                caseSensitiveOverride: false,
                recursiveScanning: true,
                notes: 'Primary world book. Keep contents concise; budget is shared with chat lore.',
            },
            expanded: true,
            children: [
                makeFolder({
                    id: 'geography',
                    parentId: 'realm-root',
                    name: 'Geography',
                    children: [
                        makeFolder({
                            id: 'cities',
                            parentId: 'geography',
                            name: 'Cities',
                            children: [
                                makeEntry({
                                    id: 'card-bristlemark',
                                    parentId: 'cities',
                                    name: 'Bristlemark',
                                    uid: 0,
                                    keys: ['Bristlemark', 'the Bridgehold'],
                                    content:
                                        'Capital of Aldermeer, built on the confluence of the Lira and the Ossen. Terraced grey stone and whitewashed timber around the fortified Bridgehold span; a harbor district that never sleeps; archives prized (and refused) by scholars of two kingdoms.\n\n### City law\n- Harbor traffic answers to the **Bridgehold** watch, not the guilds.\n- Every barge files a manifest; the *archivists* keep copies forever.\n\n### See also\n\n![Aldermeer sketch](img:img-map)\n\nThe sketch above shows the confluence as the cartographers draw it. More on the [World Info docs](https://docs.sillytavern.app/usage/core-concepts/worldinfo/).',
                                    bookMemberships: [REALM_BOOK],
                                    fields: {
                                        order: 110,
                                        group: 'cities',
                                        groupWeight: 80,
                                    },
                                }),
                                makeEntry({
                                    id: 'card-cinderhollow',
                                    parentId: 'cities',
                                    name: 'Cinderhollow',
                                    uid: 1,
                                    keys: ['Cinderhollow', 'Cinder hollow'],
                                    content:
                                        'Marcher market town at the edge of the Verdant Span, living on charcoal, resin, and the honest traffic of the Pale Roads. Watchtower now a granary; the beacons beyond it are never let to die.',
                                    bookMemberships: [REALM_BOOK],
                                    fields: {
                                        order: 90,
                                        keysecondary: ['peaceful'],
                                        selectiveLogic: 2,
                                    },
                                }),
                                makeEntry({
                                    id: 'note-city-names',
                                    parentId: 'cities',
                                    name: 'City naming ideas',
                                    uid: 60,
                                    keys: [],
                                    content:
                                        'Keep river-trading names short and consonant heavy.\nPossible future towns: Ferrow, Ossenford, Lira Staithe.\nAvoid repeating the -mark suffix; Bristlemark should stay unique.',
                                    bookMemberships: [REALM_BOOK],
                                }),
                            ],
                        }),
                        makeEntry({
                            id: 'card-verdant-span',
                            parentId: 'geography',
                            name: 'The Verdant Span',
                            uid: 2,
                            keys: ['Verdant Span', 'the deep woods'],
                            content:
                                'Broad belt of old growth east of the Lowlands; timber store, hunting ground, and refuge. Licensed wardens sell charcoal and resin rights; woodsmen observe one rule older than law: out of the deep woods before the evening mist.\n\n## Why the mist matters\n- Parties that linger come back **one member short**.\n- The custom is taught as *etiquette*, not fear.\n- Charcoal licenses press deeper every year; see `Realm research snippets`.',
                            bookMemberships: [REALM_BOOK],
                            fields: {
                                order: 120,
                                position: 1,
                            },
                        }),
                        makeEntry({
                            id: 'note-map-todos',
                            parentId: 'geography',
                            name: 'Map sketch todos',
                            uid: 61,
                            keys: [],
                            content:
                                'Fix the Lira source (fells or beyond?).\nMark all four beacon towers on the marches.\nDecide where the Stonecord crosses the Ossen.',
                            bookMemberships: [REALM_BOOK],
                        }),
                        makeImage('img-map', 'geography', 'Aldermeer map sketch', 'Rough sketch: the Lira, the Ossen, and Bristlemark at the confluence.', svgToDataUri(MAP_SVG)),
                    ],
                }),
                makeFolder({
                    id: 'factions',
                    parentId: 'realm-root',
                    name: 'Factions',
                    children: [
                        makeEntry({
                            id: 'card-gilded-circle',
                            parentId: 'factions',
                            name: 'The Gilded Circle',
                            uid: 3,
                            keys: ['Gilded Circle', 'the consortium'],
                            content:
                                'Bristlemark merchant consortium: lending desk, intelligence service, and foreign policy in one. Lends on cargo, never on crowns. Wants open bridges, honest weights, and no Taxes New.',
                            bookMemberships: [REALM_BOOK],
                            fields: {
                                order: 140,
                                group: 'factions',
                            },
                        }),
                        makeEntry({
                            id: 'card-quiet-flame',
                            parentId: 'factions',
                            name: 'Order of the Quiet Flame',
                            uid: 4,
                            keys: ['Quiet Flame', 'Flamekeepers', 'hearthhall'],
                            content:
                                'Contemplative order of lamp-keepers. Hearthhalls in every town keep a central lamp that never dies; Flamekeepers tend the sick, sit with the dying, and record one honest sentence per day in the hall daybook. Four centuries of daybooks are the realm\'s most trusted chronicle.',
                            bookMemberships: [REALM_BOOK],
                            fields: {
                                order: 130,
                                probability: 70,
                            },
                        }),
                        makeEntry({
                            id: 'note-faction-hooks',
                            parentId: 'factions',
                            name: 'Faction hooks',
                            uid: 62,
                            keys: [],
                            content:
                                'Circle vs stewards: the toll question goes to the Moot again this year.\nQuiet Flame daybook could settle a boundary dispute plot.\nMarcher lords present the beacon maintenance bill, politely, every Moot.',
                            bookMemberships: [REALM_BOOK],
                        }),
                    ],
                }),
                makeEntry({
                    id: 'card-realm-overview',
                    parentId: 'realm-root',
                    name: 'Aldermeer, Realm of Two Rivers',
                    uid: 5,
                    keys: ['Aldermeer', 'the realm'],
                    content: REALM_OVERVIEW_CONTENT,
                    bookMemberships: [REALM_BOOK],
                    contentLengthClass: 'long',
                    fields: {
                        constant: true,
                        order: 200,
                    },
                }),
                makeEntry({
                    id: 'note-realm-research',
                    parentId: 'realm-root',
                    name: 'Realm research snippets',
                    uid: 63,
                    keys: [],
                    content:
                        'Three old stocks: Riverborn (ledger), Fellborn (flock and fire), Marchborn (watchfulness).\nCustoms are load-bearing: dikes, mist rule, beacons, ledgers.\nYearly hinges: Thaw Reckoning, Dike Walk, Stamp Night, Lamp Night.',
                    bookMemberships: [REALM_BOOK],
                }),
                makeFolder({
                    id: 'marches-root',
                    parentId: 'realm-root',
                    name: 'The Ashen Marches',
                    isWiRoot: true,
                    wiSettings: {
                        bookName: MARCHES_BOOK,
                        scanDepthOverride: 4,
                        caseSensitiveOverride: true,
                        recursiveScanning: true,
                        notes: 'Border sub-book. Entries here also belong to the realm book (intersection by design).',
                    },
                    children: [
                        makeEntry({
                            id: 'card-vesk-harrow',
                            parentId: 'marches-root',
                            name: 'Vesk Harrow',
                            uid: 6,
                            keys: ['Vesk Harrow', 'Lord of the Marches'],
                            content:
                                'Present Lord of the Marches. Keeps the old border oath framed above his hearth and reads it aloud each year on the night the beacons are tested. Proud, prickly, charitable to travelers, indifferent to river-town opinion.',
                            bookMemberships: [REALM_BOOK, MARCHES_BOOK],
                            fields: {
                                position: 4,
                                depth: 6,
                                role: 1,
                            },
                        }),
                        makeEntry({
                            id: 'card-pale-roads',
                            parentId: 'marches-root',
                            name: 'The Pale Roads',
                            uid: 7,
                            keys: ['Pale Roads'],
                            content:
                                'Old volcanic-dust causeways through the Marches: narrow, pale, safe by marcher law, eerie by common report. Caravans keep a running conversation on them for no reason anyone admits.',
                            bookMemberships: [REALM_BOOK, MARCHES_BOOK],
                            fields: {
                                sticky: 3,
                                cooldown: 2,
                            },
                        }),
                        makeEntry({
                            id: 'card-cinderfall-watch',
                            parentId: 'marches-root',
                            name: 'Cinderfall Watch',
                            uid: 8,
                            keys: ['Cinderfall Watch', 'the watchtower'],
                            content:
                                'The largest of the old border watchtowers, now a granary with a garrison floor. Its beacon is the first lit and the last doused each year; the tower\'s coals have not gone out in living memory.',
                            bookMemberships: [REALM_BOOK, MARCHES_BOOK],
                            fields: {
                                delay: 2,
                                triggers: ['normal', 'swipe'],
                            },
                        }),
                        makeEntry({
                            id: 'note-marches-seeds',
                            parentId: 'marches-root',
                            name: 'Marches plot seeds',
                            uid: 64,
                            keys: [],
                            content:
                                'A courier disappears on the Pale Roads; the mist rule is broken.\nThe Moot bill for beacon maintenance arrives with exact figures.\nA stranger pays in coin older than the crown.',
                            bookMemberships: [REALM_BOOK, MARCHES_BOOK],
                        }),
                        makeImage('img-beacon', 'marches-root', 'Cinderfall Watch sketch', 'Tower and beacon pan; the coals are never fully raked out.', svgToDataUri(TOWER_SVG)),
                    ],
                }),
            ],
        }),
        makeFolder({
            id: 'personal-notes',
            parentId: 'workspace-root',
            name: 'Personal Notes',
            children: [
                makeEntry({
                    id: 'note-workspace-todo',
                    parentId: 'personal-notes',
                    name: 'Workspace todo',
                    uid: 65,
                    keys: [],
                    content:
                        'Split lore into two books: realm and marches (done).\nAsk the assistant for a batch of commoner-life cards.\nCheck which cards fire during a real chat.',
                }),
                makeEntry({
                    id: 'note-style-experiments',
                    parentId: 'personal-notes',
                    name: 'Style experiments',
                    uid: 66,
                    keys: [],
                    content:
                        'Try second person for the city cards.\nKeep sentences short in activation-critical content.\nNever put keys in the content; describe, do not list.',
                }),
            ],
        }),
        makeFolder({
            id: 'sandbox',
            parentId: 'workspace-root',
            name: 'Sandbox',
            children: Array.from({ length: 32 }, (_, index) => {
                const number = index + 1;
                const padded = String(number).padStart(2, '0');
                return makeEntry({
                    id: `sandbox-${padded}`,
                    parentId: 'sandbox',
                    name: `Sandbox Entry ${padded}`,
                    uid: 20 + index,
                    keys: [`sandbox entry ${number}`],
                    content: `Sandbox entry ${padded} is a scratch card kept for interface testing. It exercises list scrolling and selection at volume and carries no world significance. Edit nothing here that you expect to keep.`,
                    fields: {
                        order: 100 + number,
                        disable: number % 5 === 0,
                    },
                });
            }),
        }),
    ],
});

export const SAMPLE_DATASET: SampleDataset = {
    meta: {
        title: 'Aldermeer Workspace',
        prototypeLabel: 'PROTOTYPE - nothing is saved',
    },
    root: tree,
};

