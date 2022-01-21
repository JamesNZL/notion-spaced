"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@notionhq/client");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const moment_1 = __importDefault(require("moment"));
const CONSTANTS = {
    CALENDAR_TITLE: 'Repetition Calendar',
    DATE_FORMAT: 'YYYY-MM-DD',
    CLASS_PROPERTY_NAME: 'Class',
    REPEATS: {
        '1st rep': {
            emoji: '1️⃣',
            momentOffset: { days: 1 },
        },
        '2nd rep': {
            emoji: '2️⃣',
            momentOffset: { weeks: 1 },
        },
        '3rd rep': {
            emoji: '3️⃣',
            momentOffset: { weeks: 2 },
        },
        '4th rep': {
            emoji: '4️⃣',
            momentOffset: { months: 1 },
        },
    },
};
const notion = new client_1.Client({ auth: process.env.NOTION_KEY });
function handleError(error) {
    const type = ((0, client_1.isNotionClientError)(error)) ? 'NOTION_ERROR' : 'UNKNOWN_ERROR';
    console.error({ type, error });
}
async function retrieveBlockChildren(blockId) {
    try {
        return await notion.blocks.children.list({ block_id: blockId });
    }
    catch (error) {
        handleError(error);
    }
}
async function queryDatabase(databaseId) {
    try {
        return await notion.databases.query({ database_id: databaseId });
    }
    catch (error) {
        handleError(error);
    }
}
async function createPage(parameters) {
    try {
        return await notion.pages.create(parameters);
    }
    catch (error) {
        handleError(error);
    }
}
function resolvePageName(page) {
    return ('properties' in page && 'title' in page.properties.Name) ? page.properties.Name.title.map(({ plain_text }) => plain_text).join('') : '';
}
function getRepeatDate(createdTime, momentOffset) {
    return (0, moment_1.default)(createdTime).add(momentOffset).format(CONSTANTS.DATE_FORMAT);
}
function getBoardIds(blocks) {
    // Filter the blocks for databases whose names do not match the configured calendar name
    return blocks.filter(block => 'type' in block && block?.type === 'child_database' && block?.child_database?.title !== CONSTANTS.CALENDAR_TITLE)
        // Map each block child to its identifier only
        .map(block => block.id);
}
async function resolveRepeatsFromBoards(boardIds) {
    const repeats = await Promise.all(
    // Extract the repeats from each Class Board
    boardIds.map(async (boardId) => {
        // Attempt to query the board database
        const response = await queryDatabase(boardId);
        // If the boardId is a valid database, return its array of results, otherwise return an empty array
        return (response?.results) ? response.results : [];
    }));
    // Flatten the repeats array by one level so that all repeats from all boards are concatenated into a single <Page[]> array
    return repeats.flat(1);
}
function calendarHasPage(calendarPages, { pageTitle, pageDate }) {
    return calendarPages.results.some(page => 'properties' in page && resolvePageName(page) === pageTitle && 'date' in page.properties.Date && page.properties.Date.date?.start === pageDate);
}
async function createCalendarPage(calendarId, repeatSerial, repeatId, repeatIcon, repeatClass, pageDate) {
    // Construct the parent object for the CreatePageParameters
    const parent = {
        type: 'database_id',
        database_id: calendarId,
    };
    // Construct the properties object
    const properties = {
        Name: {
            title: [
                {
                    text: {
                        // Prefix the page title with the repeat serial's emoji
                        content: `${CONSTANTS.REPEATS[repeatSerial].emoji} `,
                    },
                },
                {
                    mention: {
                        page: {
                            // Then add a mention to the repeat's page
                            id: repeatId,
                        },
                    },
                },
                {
                    text: {
                        // Suffix the page title with the repeat serial
                        content: ` ${repeatSerial}`,
                    },
                },
            ],
        },
        Date: {
            date: {
                // Set the calendar page date
                start: pageDate,
            },
        },
    };
    if (repeatClass) {
        properties[CONSTANTS.CLASS_PROPERTY_NAME] = {
            select: {
                name: repeatClass,
            },
        };
    }
    // Construct the icon object
    const icon = {
        type: 'emoji',
        // Use the repeat's icon if it exists, otherwise use the repeat serial's emoji
        emoji: repeatIcon || CONSTANTS.REPEATS[repeatSerial].emoji,
    };
    // Create the page
    return await createPage({ parent, properties, icon });
}
async function updateCalendar(parentBlockId) {
    if (parentBlockId) {
        // Retrieve the children of the parent block
        const blockChildren = await retrieveBlockChildren(parentBlockId);
        // Continue if there were children found
        if (blockChildren) {
            // Obtain an array of all Class Board database identifiers
            const boardIds = getBoardIds(blockChildren.results);
            // Find the identifier of the configured calendar database
            const calendarId = blockChildren.results
                .find(block => 'child_database' in block && block?.child_database?.title === CONSTANTS.CALENDAR_TITLE)
                ?.id;
            // Continue if both the Calendar and at least one Class Board was found
            if (calendarId && boardIds?.length) {
                // Resolve all the repeats from all boards into a single <Page[]>
                const repeats = await resolveRepeatsFromBoards(boardIds);
                // Attempt to query the calendar database
                const calendarPages = await queryDatabase(calendarId);
                // Continue if the calendarId is a valid database
                if (calendarPages?.results) {
                    // Iterate through every repeat that was found
                    repeats.forEach(repeat => {
                        if ('properties' in repeat && 'created_time' in repeat) {
                            // Resolve the repeat's name and icon
                            const repeatName = ('title' in repeat.properties.Name) ? resolvePageName(repeat) : 'Unknown Title';
                            const repeatIcon = (repeat.icon !== null && 'emoji' in repeat.icon) ? repeat.icon.emoji : null;
                            const repeatClass = (CONSTANTS.CLASS_PROPERTY_NAME in repeat.properties && 'select' in repeat.properties?.[CONSTANTS.CLASS_PROPERTY_NAME]) ? repeat.properties?.[CONSTANTS.CLASS_PROPERTY_NAME]?.select?.name : null;
                            // Iterate through each repeat serial
                            Object.entries(CONSTANTS.REPEATS)
                                .forEach(([repeatSerial, repeatObject]) => {
                                // Construct the title for the calendar page
                                const pageTitle = `${CONSTANTS.REPEATS[repeatSerial].emoji} ${repeatName} ${repeatSerial}`;
                                // Calculate the date for the calendar page
                                const pageDate = getRepeatDate(repeat.created_time, repeatObject.momentOffset);
                                // If the calendar already has a matching page, cease further execution
                                if (calendarHasPage(calendarPages, { pageTitle, pageDate }))
                                    return;
                                // Otherwise, create the calendar page
                                else
                                    createCalendarPage(calendarId, repeatSerial, repeat.id, repeatIcon, repeatClass, pageDate);
                            });
                        }
                    });
                    console.log('Updated calendar!');
                }
            }
        }
    }
}
// Update the calendar
updateCalendar(process.env.NOTION_BLOCK_ID);
//# sourceMappingURL=index.js.map