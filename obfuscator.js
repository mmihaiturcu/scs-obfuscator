const fs = require("fs");
const crypto = require("crypto");
const axios = require("axios");
const { exec } = require("child_process");

/**
 * Function which retrieves a truly generated number from the Random.org TRNG (which is based on atmospheric noise)
 * @returns truly random number between 10000 and 99999
 */
async function getTrueRandomFileNumber() {
	return await axios.get(
		"https://www.random.org/integers/?num=1&min=10000&max=99999&col=1&base=10&format=plain&rnd=new"
	);
}

/**
 * Function which appends a string to the provided filename, before its extension.
 *
 * @param {*} filename - filename to which to append a string before the extension.
 * @param {*} string - string to be appended
 * @returns filename to which `string` has been appended.
 */
function appendToFilenameBeforeExtension(filename, string) {
	const dotIndex = filename.lastIndexOf(".");
	if (dotIndex == -1) return filename + string;
	else
		return (
			filename.substring(0, dotIndex) +
			string +
			filename.substring(dotIndex)
		);
}

const generatedRandomStringMap = new Map();

function generateRandomString(length) {
	return crypto.randomBytes(length).toString("hex");
}

function isNumber(str) {
	return /^\d+$/.test(str);
}

function getNonNumericFirstLetterString(string) {
	while (isNumber(string[0])) {
		string = `${generateRandomString(4)[0]}${string.substring(1)}`;
	}

	return string;
}

function getRandomStringWithDuplicateCheck() {
	const randomString = getNonNumericFirstLetterString(
		generateRandomString(8)
	);

	if (generatedRandomStringMap.has(randomString)) {
		return getRandomStringWithDuplicateCheck();
	} else {
		generatedRandomStringMap.set(randomString, true);
		return randomString;
	}
}

const validPostFunctionSymbols = new Map(
	Object.entries({
		"(": true,
		" ": true,
	})
);

const keywords = ["return", "for", "int", "if", "while", "void"];

class Obfuscator {
	constructor(sourceCodeFilename) {
		this.sourceCodeFilename = sourceCodeFilename;
		this.sourceCode = fs.readFileSync(sourceCodeFilename).toString();
		this.variableToRandomStringMap = new Map();
		this.functionNameToRandomStringMap = new Map();
		this.libraryFunctionNameToRandomStringMap = new Map();
		this.keywordsToRandomStringMap = new Map();
		this.definedSymbols = new Map();
	}

	extractKeywords() {
		keywords.forEach((keyword) => {
			if (this.sourceCode.includes(keyword)) {
				this.keywordsToRandomStringMap.set(
					keyword,
					getRandomStringWithDuplicateCheck()
				);
			}
		});
	}

	async removeComments() {
		return new Promise((resolve) => {
			exec(
				`gcc -fpreprocessed -dD -E -P ${this.sourceCodeFilename}`,
				(err, stdout, stderr) => {
					this.sourceCode = stdout;
					resolve(true);
				}
			);
		});
	}

	extractVariables() {
		// Below regex credit: https://stackoverflow.com/questions/12993187/regular-expression-to-recognize-variable-declarations-in-c (enhancement via forEach added by me to capture multiple variable declaration)

		// Extract all variable names
		[
			...this.sourceCode.matchAll(
				/\b(?:(?:auto\s*|const\s*|unsigned\s*|signed\s*|register\s*|volatile\s*|static\s*|void\s*|short\s*|long\s*|char\s*|int\s*|float\s*|double\s*|_Bool\s*|complex\s*)+)(?:\s+\*?\*?\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*[\[;,=)]/g
			),
		].forEach((match) => {
			if (match[0][match[0].length - 1] === ",") {
				// Parse until the next ; to find all other subsequent variables in this declaration
				const lineRemainder = this.sourceCode
					.substring(
						match.index + match[0].length - 1,
						this.sourceCode.indexOf(";", match.index + 1)
					)
					.trim()
					.split(",")
					.filter((part) => part)
					.map((part) => part.trim());

				// Store the other variables found
				lineRemainder
					.map((line) => line.substring(0, line.indexOf("=")).trim())
					.forEach((variableName) =>
						this.variableToRandomStringMap.set(
							variableName,
							getRandomStringWithDuplicateCheck()
						)
					);
			}

			this.variableToRandomStringMap.set(
				match[1],
				getRandomStringWithDuplicateCheck()
			);
		});

		return this;
	}

	extractFunctionNames() {
		return new Promise((resolve) => {
			exec(
				`gcc -aux-info functions.txt ${this.sourceCodeFilename}`,
				(err, stdout, stderr) => {
					const auxInfoOutput = fs
						.readFileSync("functions.txt")
						.toString();

					const functionLines = auxInfoOutput.split("\n");
					functionLines.shift();

					functionLines.forEach((line) => {
						if (line) {
							const match = line.match(/(?<=extern\s).*(?=\s\()/);

							if (match) {
								if (line.includes(this.sourceCodeFilename)) {
									this.functionNameToRandomStringMap.set(
										match[0].split(" ")[1].replace("*", ""),
										getRandomStringWithDuplicateCheck()
									);
								} else {
									this.libraryFunctionNameToRandomStringMap.set(
										match[0].split(" ")[1].replace("*", ""),
										getRandomStringWithDuplicateCheck()
									);
								}
							}
						}
					});

					this.functionNameToRandomStringMap.delete("main");
					this.libraryFunctionNameToRandomStringMap.set(
						"main",
						getRandomStringWithDuplicateCheck()
					);
					fs.unlinkSync("functions.txt");
					fs.unlinkSync("a.exe");

					resolve(true);
				}
			);
		});
	}

	extractExistingDefines() {
		const defines = this.sourceCode.match(/[\n\r].*#define\s*([^\n\r]*)/g);
		if (defines) {
			defines.forEach((define) =>
				this.definedSymbols.set(
					define.split(" ")[1],
					getRandomStringWithDuplicateCheck()
				)
			);
		}
	}

	replaceExtractedSymbols() {
		this.variableToRandomStringMap.forEach((randomString, symbolName) => {
			this.sourceCode = this.sourceCode.replace(
				new RegExp(`\\b${symbolName}\\b`, "g"),
				(a, b, c) => {
					// Check if the found value is within a string
					if (
						c
							.substring(b + a.length, c.indexOf(";", b + 1))
							.includes('")')
					) {
						// Invalid, it is within a string, we should leave strings untouched.
						return a;
					} else {
						// Valid, not within a string.
						return randomString;
					}
				}
			);
		});

		this.definedSymbols.forEach((randomString, symbolName) => {
			this.sourceCode = this.sourceCode.replaceAll(
				new RegExp(`\\b${symbolName}\\b`, "g"),
				randomString
			);
		});

		this.keywordsToRandomStringMap.forEach((randomString, symbolName) => {
			this.sourceCode = this.sourceCode.replace(
				new RegExp(`\\b${symbolName}\\b`, "g"),
				(a, b, c) => {
					// Check if the found value is within a string
					if (
						c
							.substring(b + a.length, c.indexOf(";", b + 1))
							.includes('"')
					) {
						// Invalid, it is within a string, we should leave strings untouched.
						return a;
					} else {
						// Valid, not within a string.
						return randomString;
					}
				}
			);
			this.sourceCode = `#define ${randomString} ${symbolName}\n${this.sourceCode}`;
		});

		this.functionNameToRandomStringMap.forEach(
			(randomString, functionName) => {
				this.sourceCode = this.sourceCode.replace(
					new RegExp(functionName, "g"),
					(a, b, c) => {
						// The matched function name could be a substring of another function name, so we should check if the characters following it are ( or blank space
						if (
							validPostFunctionSymbols.has(
								this.sourceCode[b + functionName.length]
							)
						) {
							// Valid, the whole function name was matched => replace it with the random string.
							return randomString;
						} else {
							// Invalid, the functionName is a substring of the matched function, do not replace the function name, it will be replaced in a future iteration.
							return a;
						}
					}
				);
			}
		);

		const libraryFunctionNameDefines = new Set();
		this.libraryFunctionNameToRandomStringMap.forEach(
			(randomString, functionName) => {
				this.sourceCode = this.sourceCode.replace(
					new RegExp(functionName, "g"),
					(a, b, c) => {
						// The matched function name could be a substring of another function name, so we should check if the characters following it are ( or blank space
						if (
							validPostFunctionSymbols.has(
								this.sourceCode[b + functionName.length]
							)
						) {
							libraryFunctionNameDefines.add(
								`#define ${randomString} ${functionName}\n`
							);

							// Valid, the whole function name was matched => replace it with the random string.
							return randomString;
						} else {
							// Invalid, the functionName is a substring of the matched function, do not replace the function name, it will be replaced in a future iteration.
							return a;
						}
					}
				);
			}
		);

		libraryFunctionNameDefines.forEach(
			(define) => (this.sourceCode = `${define}${this.sourceCode}`)
		);

		return this;
	}

	removeUnnecessaryWhitespace() {
		const arrayOfLines = this.sourceCode.match(/[^\r\n]+/g);
		let string = "";
		arrayOfLines.forEach((line) => {
			string += line;
			if (line[0] === "#") {
				string += "\n";
			}
		});

		this.sourceCode = string.replace(/\s\s+/g, " ");
	}

	async saveObfuscatedCode() {
		const trulyRandomNumber = (await getTrueRandomFileNumber()).data;

		this.newFilename = appendToFilenameBeforeExtension(
			this.sourceCodeFilename,
			trulyRandomNumber
		);

		fs.writeFileSync(this.newFilename, this.sourceCode);
	}
}

async function obfuscate() {
	const args = process.argv;

	if (args.length == 2) {
		throw new Error(
			"The source code file's name must be supplied as a command line argument. Example: node obfuscator example1.c"
		);
	}

	const obfuscator = new Obfuscator(args[2]);

	obfuscator.extractKeywords();
	await obfuscator.removeComments();
	obfuscator.extractVariables();

	await obfuscator.extractFunctionNames();

	obfuscator.extractExistingDefines();

	obfuscator.replaceExtractedSymbols();

	obfuscator.removeUnnecessaryWhitespace();

	await obfuscator.saveObfuscatedCode();
}

obfuscate();
