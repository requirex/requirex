export class Package {

	constructor(
		public name: string,
		public root: string
	) {}

	version: string;
	main?: string;
	map: { [name: string]: string } = {};

}
