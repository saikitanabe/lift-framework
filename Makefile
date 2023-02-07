build-minify:
	make -C scripts/minify build

publish-m2:
	make -C scripts/minify deploy
	sbt package publishM2
