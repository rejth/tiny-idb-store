export const setByPath = (record: Record<string, unknown>, path: string, value: unknown): void => {
	let current = record;
	const parts = path.split(".");

	for (const [index, part] of parts.entries()) {
		if (index === parts.length - 1) {
			current[part] = value;
			return;
		}

		if (typeof current[part] !== "object" || current[part] === null) {
			current[part] = {};
		}

		current = current[part] as Record<string, unknown>;
	}
};
