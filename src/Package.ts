export class Package {

	constructor(public root: string) {}

	version: string;
	main?: string;
	map: { [name: string]: string } = {};

}
