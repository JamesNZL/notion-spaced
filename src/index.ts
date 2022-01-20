import { Client, isNotionClientError } from '@notionhq/client';
import { CreatePageParameters, CreatePageResponse, ListBlockChildrenResponse, QueryDatabaseResponse } from '@notionhq/client/build/src/api-endpoints';

import * as dotenv from 'dotenv';
dotenv.config();

import dateFormat from 'dateformat';

type ArrayElement<ArrayType extends readonly unknown[]> = ArrayType extends readonly (infer ElementType)[] ? ElementType : never;

type RepeatSerial = '1st rep' | '2nd rep' | '3rd rep' | '4th rep';
type RepeatEmoji = '1️⃣' | '2️⃣' | '3️⃣' | '4️⃣';

type Repeats = {
	[key in RepeatSerial]: RepeatEmoji
};

interface Constants {
	CALENDAR_TITLE: string;
	REPEATS: Repeats;
}

const CONSTANTS: Constants = {
	CALENDAR_TITLE: 'Repetition Calendar',
	REPEATS: {
		'1st rep': '1️⃣',
		'2nd rep': '2️⃣',
		'3rd rep': '3️⃣',
		'4th rep': '4️⃣',
	},
};

const notion = new Client({ auth: <string>process.env.NOTION_KEY });

function resolvePageName(page: ArrayElement<QueryDatabaseResponse['results']>): string {
	return ('properties' in page && 'title' in page.properties.Name) ? page.properties.Name.title.map(({ plain_text }) => plain_text).join('') : '';
}

function handleError(error: unknown): void {
	const type = (isNotionClientError(error)) ? 'NOTION_ERROR' : 'UNKNOWN_ERROR';

	console.log({ type, error });
}

async function retrieveBlockChildren(blockId: string): Promise<void | ListBlockChildrenResponse> {
	try {
		return await notion.blocks.children.list({ block_id: blockId });
	}

	catch (error: unknown) {
		handleError(error);
	}
}

async function queryDatabase(databaseId: string): Promise<void | QueryDatabaseResponse> {
	try {
		return await notion.databases.query({ database_id: databaseId });
	}

	catch (error: unknown) {
		handleError(error);
	}
}

async function createPage(parameters: CreatePageParameters): Promise<void | CreatePageResponse> {
	try {
		return await notion.pages.create(parameters);
	}

	catch (error: unknown) {
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
					boardIds.map(async (databaseId: string): Promise<QueryDatabaseResponse['results'] | []> => {
						const response = await queryDatabase(databaseId);

						return (response) ? response.results : [];
					}),
				);

				const calendarPages = await queryDatabase(calendarId);

				if (calendarPages?.results) {
					// Flatten the array to remove boards with no repeats
					repeats.flat(1)
						.forEach(repeat => {
							if ('properties' in repeat) {
								const repeatName = ('title' in repeat.properties.Name) ? resolvePageName(repeat) : 'Unknown Title';
								const repeatIcon = (repeat.icon !== null && 'emoji' in repeat.icon) ? repeat.icon.emoji : null;

								Object.entries(repeat.properties)
									.filter(([key, value]) => Object.keys(CONSTANTS.REPEATS).includes(key) && value.type === 'formula')
									.forEach(async ([key, value]) => {
										if (value.type === 'formula' && 'string' in value.formula) {
											const repeatDate = value?.formula?.string;

											if (repeatDate) {
												const pageTitle = `${CONSTANTS.REPEATS[<RepeatSerial>key]} ${repeatName} ${key}`;
												const pageDate = dateFormat(repeatDate, 'isoDate');

												if (calendarPages.results.some(page => 'properties' in page && resolvePageName(page) === pageTitle && 'date' in page.properties.Date && page.properties.Date.date?.start === pageDate)) return;

												const parent: CreatePageParameters['parent'] = {
													type: 'database_id',
													database_id: calendarId,
												};

												const properties: CreatePageParameters['properties'] = {
													Name: {
														title: [
															{
																text: {
																	content: `${CONSTANTS.REPEATS[<RepeatSerial>key]} `,
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

												const icon: CreatePageParameters['icon'] = {
													type: 'emoji',
													emoji: repeatIcon || CONSTANTS.REPEATS[<RepeatSerial>key],
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