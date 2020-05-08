export class Package {

	constructor(
		public name: string,
		public rootKey: string
	) { }

	version?: string;
	main?: string;
	map: { [name: string]: string } = {};

}
