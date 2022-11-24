DefaultOptions.addPluginResolvers
resolvers += Resolver.typesafeRepo("releases")

addSbtPlugin("com.typesafe.sbt" % "sbt-web" % "1.4.4")
//addSbtPlugin("org.jetbrains" % "sbt-idea-plugin" % "2.1.3")

lazy val buildPlugin = RootProject(uri("https://github.com/lift/sbt-lift-build.git#f9c52bda7b43a98b9f8805c654c713d99db0a58f"))
lazy val root        = (project in file(".")).dependsOn(buildPlugin)

addSbtPlugin("com.github.sbt" % "sbt-unidoc" % "0.5.0")
