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
const dateformat_1 = __importDefault(require("dateformat"));
const CONSTANTS = {
    CALENDAR_TITLE: 'Repetition Calendar',
    REPEATS: {
        '1st rep': '1️⃣',
        '2nd rep': '2️⃣',
        '3rd rep': '3️⃣',
        '4th rep': '4️⃣',
    },
};
const notion = new client_1.Client({ auth: process.env.NOTION_KEY });
function resolvePageName(page) {
    return ('properties' in page && 'title' in page.properties.Name) ? page.properties.Name.title.map(({ plain_text }) => plain_text).join('') : '';
}
function handleError(error) {
    const type = ((0, client_1.isNotionClientError)(error)) ? 'NOTION_ERROR' : 'UNKNOWN_ERROR';
    console.log({ type, error });
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
(async () => {
    // Parse the blockId for the Classes page from .env
    const blockId = process.env.NOTION_BLOCK_ID;
    if (blockId) {
        // Retrieve the Classes children
        const blockChildren = await retrieveBlockChildren(blockId);
        if (blockChildren) {
            // Obtain an array of Class Board database identifiers
            const boardIds = blockChildren.results
                // Filter the block children for databases whose names do not match the calendar database
                .filter(block => 'type' in block && block?.type === 'child_database' && block?.child_database?.title !== CONSTANTS.CALENDAR_TITLE)
                // Map each block child to its identifier only
                .map(block => block.id);
            const calendarId = blockChildren.results
                .find(block => 'child_database' in block && block?.child_database?.title === CONSTANTS.CALENDAR_TITLE)
                ?.id;
            // Continue if both the Calendar and at least one Class Board was found
            if (calendarId && boardIds?.length) {
                const repeats = await Promise.all(
                // Extract all the repeats from each Class Board
                boardIds.map(async (databaseId) => {
                    const response = await queryDatabase(databaseId);
                    return (response) ? response.results : [];
                }));
                const calendarPages = await queryDatabase(calendarId);
                if (calendarPages?.results) {
                    // Flatten the array to remove boards with no repeats
                    repeats.flat(1)
                        .forEach(repeat => {
                        if ('properties' in repeat) {
                            const repeatName = ('title' in repeat.properties.Name) ? repeat.properties.Name.title[0]?.plain_text : 'Unknown Title';
                            const repeatIcon = (repeat.icon !== null && 'emoji' in repeat.icon) ? repeat.icon.emoji : null;
                            Object.entries(repeat.properties)
                                .filter(([key, value]) => Object.keys(CONSTANTS.REPEATS).includes(key) && value.type === 'formula')
                                .forEach(async ([key, value]) => {
                                if (value.type === 'formula' && 'string' in value.formula) {
                                    const repeatDate = value?.formula?.string;
                                    if (repeatDate) {
                                        const pageTitle = `${CONSTANTS.REPEATS[key]} ${repeatName} ${key}`;
                                        const pageDate = (0, dateformat_1.default)(repeatDate, 'isoDate');
                                        if (calendarPages.results.some(page => 'properties' in page && resolvePageName(page) === pageTitle && 'date' in page.properties.Date && page.properties.Date.date?.start === pageDate))
                                            return;
                                        const parent = {
                                            type: 'database_id',
                                            database_id: calendarId,
                                        };
                                        const properties = {
                                            Name: {
                                                title: [
                                                    {
                                                        text: {
                                                            content: `${CONSTANTS.REPEATS[key]} `,
                                                        },
                                                    },
                                                    {
                                                        mention: {
                                                            page: {
                                                                id: repeat.id,
                                                            },
                                                        },
                                                    },
                                                    {
                                                        text: {
                                                            content: ` ${key}`,
                                                        },
                                                    },
                                                ],
                                            },
                                            Date: {
                                                date: {
                                                    start: pageDate,
                                                },
                                            },
                                        };
                                        const icon = {
                                            type: 'emoji',
                                            emoji: repeatIcon || CONSTANTS.REPEATS[key],
                                        };
                                        await createPage({ parent, properties, icon });
                                        console.log(`Created page ${pageTitle}`);
                                    }
                                }
                            });
                        }
                    });
                }
            }
        }
    }
})();
async function clearCalendar(databaseId) {
    async function deleteBlock(blockId) {
        await notion.blocks.delete({ block_id: blockId });
    }
    const calendar = await queryDatabase(databaseId);
    if (calendar?.results?.length) {
        calendar.results.forEach(page => deleteBlock(page.id));
    }
}
// clearCalendar('7d9e3260ef3f4005a586ecb0c423a9f1');
//# sourceMappingURL=index.js.map