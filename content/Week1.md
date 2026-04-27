## What are Knowledge Graphs

A **Knowledge Graph** is a graph-structured representation of real-world entities and the relationships between them, intended to accumulate and convey knowledge that can be queried, reasoned over, and continuously enriched.

### The three things a KG must do

 Every KG in practice combines three capabilities:
 
1. **Represent** — entities as nodes, relations as labelled edges, in a graph data model.
2. **Integrate** — fuse data from heterogeneous sources under a shared identity scheme (entity resolution).
3. **Reason / query** — derive new facts via inference, or retrieve facts via a graph query language.

```mermaid
graph TD
    KG{{Knowledge Graph<br/>= all three}}:::kg
    R[Represent<br/>graph data model]:::cap
    I[Integrate<br/>shared identity / ER]:::cap
    Q[Reason / Query<br/>inference + graph QL]:::cap
    R --- KG
    I --- KG
    Q --- KG
    GraphDB[Plain Graph DB<br/>only Represent]:::sys
    DataLake[Data Lake / RDB<br/>only Integrate]:::sys
    Prolog[Prolog / Rule engine<br/>only Reason]:::sys
    GraphDB -.precursor.-> R
    DataLake -.precursor.-> I
    Prolog -.precursor.-> Q
    classDef kg fill:#BAE6FD,stroke:#0284C7,color:#0F172A
    classDef cap fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef sys fill:#f3f4f6,stroke:#9ca3af,color:#374151
```


### The four types Knowledge Graph

**Encyclopedic Knowledge Graphs**

- **Purpose:** Represent general, real-world knowledge.
- **Characteristics:** These are the most ubiquitous KGs. They are constructed by integrating massive amounts of information from extensive sources, including human experts, encyclopedias (like Wikipedia), and various databases. Some automatically extract web data to improve over time.
- **Examples:** Wikidata, Freebase, DBpedia, YAGO, NELL, and Knowledge Ocean (KO).

**Commonsense Knowledge Graphs**

- **Purpose:** Formulate knowledge about everyday concepts, objects, events, and their relationships.
- **Characteristics:** Unlike encyclopedic KGs, these model "tacit" knowledge extracted from text (e.g., understanding that a _Car_ is _UsedFor_ a _Drive_). They are crucial for helping computers understand human language meanings and causal effects for reasoning.
- **Examples:** ConceptNet, ATOMIC, ASER, TransOMCS, and CausalBank.

**Domain-specific Knowledge Graphs**

- **Purpose:** Represent highly specialized knowledge within a particular field, such as medicine, biology, finance, geology, chemistry, or genealogy.
- **Characteristics:** Compared to general encyclopedic KGs, they are typically smaller in size but offer much higher accuracy and reliability for their specific domains.
- **Examples:** UMLS (biomedical concepts).

**Multi-modal Knowledge Graphs**

- **Purpose:** Represent facts across multiple modalities, breaking away from conventional text-only data.
- **Characteristics:** They incorporate non-textual information like images, sounds, and videos alongside text. This makes them highly useful for multi-modal tasks like image-text matching, visual question answering, and recommendation systems.
- **Examples:** IMGpedia, MMKG, and Richpedia.

### The two competing data models

There are two popular **Knowledge Graph Data Models**:

|                     | RDF triples                             | Property Graph (LPG)                           |
| ------------------- | --------------------------------------- | ---------------------------------------------- |
| **Atom**            | `(subject, predicate, object)` triple   | Node *with* properties; edge *with* properties |
| **Identity**        | Global IRIs                             | Local internal IDs                             |
| **Schema**          | Optional, separate (RDFS/OWL)           | Optional, often inline (labels)                |
| **Standard query**  | SPARQL                                  | Cypher / GQL / Gremlin                         |
| **Strength**        | Web-scale interop, formal semantics     | Ergonomics, traversal performance              |
| **Weakness**        | Verbose, awkward for n-ary relations    | No standard semantics, weaker reasoning        |
| **Reference impl.** | Apache Jena, GraphDB, Stardog, Virtuoso | Neo4j, TigerGraph, Memgraph                    |

Every RDF fact has exactly three positions. The picture below shows how `Alice worksAt Acme` decomposes, what each position is allowed to be, and how the same fact looks as a subgraph.

```mermaid
graph LR
    S["<b>Subject</b><br/>:alice<br/>(IRI or blank node)"]:::sub
    P{{"<b>Predicate</b><br/>:worksAt<br/>(always an IRI)"}}:::pred
    O["<b>Object</b><br/>:acme<br/>(IRI, blank node, or literal)"]:::obj
    S -->|edge labelled by P| O
    P -.-|labels| S

    classDef sub fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef pred fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef obj fill:#dcfce7,stroke:#15803d,color:#14532d
```

In RDF, attributes (`name`, `bornIn`) become extra triples; in LPG they live on the node as key-value properties. The same is true for _edge_ attributes — RDF must reify them, LPG attaches them inline.

```mermaid
graph TB
    subgraph RDF["RDF (triple-based) view"]
        A1((":alice")) -- ":worksAt" --> B1((":acme"))
        A1 -- ":hasName" --> N1["'Alice Smith'"]
        A1 -- ":bornIn" --> Y1["1990"]
    end

    subgraph LPG["Property Graph view"]
        A2(("Alice<br/><i>:Person</i><br/>name='Alice Smith'<br/>bornIn=1990")) -- "WORKS_AT<br/>since=2020" --> B2(("Acme<br/><i>:Company</i>"))
    end

    classDef rdf fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef lpg fill:#dcfce7,stroke:#15803d,color:#14532d
```


### Historical lineage

| Year  | Concept                                                          | Description                                   |
| ----- | ---------------------------------------------------------------- | --------------------------------------------- |
| 1956  | Semantic networks (Quillian)                                     | graphs of concepts, no formal semantics       |
| 1970s | Frames (Minsky)                                                  | slot-and-filler, structured but ad hoc        |
| 1980s | Description Logics (KL-ONE, ALC)                                 | formal, decidable subset of FOL               |
| 1990s | Ontologies (Gruber: "shared conceptualization")                  | vocabularies for AI knowledge sharing         |
| 1999  | **Resource Description Framework** (W3C)                         | triples as the web-scale data model           |
| 2004  | **Web Ontology Language** (W3C)                                  | DL-grounded ontology language on top of RDF   |
| 2007  | DBpedia, YAGO, Freebase                                          | first large-scale public KGs from Wikipedia   |
| 2012  | Google Knowledge Graph                                           | coined the modern term; "things, not strings" |
| 2014  | Wikidata launches                                                | collaborative, multilingual KG                |
| 2018+ | KG embeddings boom (TransE, ComplEx, RotatE) + KG-augmented LLMs | bring KGs into the deep-learning stack        |
| 2024  | GraphRAG (Microsoft)                                             | KGs as the retrieval substrate for LLMs       |

```mermaid
timeline
    title 70 years of knowledge representation
    1956 : Semantic networks (Quillian)
    1970s : Frames (Minsky)
    1980s : Description Logics (KL-ONE, ALC)
    1993 : Gruber defines "ontology"
    1999 : RDF (W3C)
    2004 : OWL (W3C)
    2007 : DBpedia, YAGO, Freebase
    2012 : Google Knowledge Graph
          : "things, not strings"
    2014 : Wikidata
    2018 : KG embedding boom (TransE, ComplEx, RotatE)
    2024 : GraphRAG (Microsoft)
```

From 2018 onward, knowledge graph (KG) research saw a surge in embedding models (TransE, ComplEx, RotatE) that map entities and relations into continuous vector spaces, enabling link prediction and neural‑driven reasoning. Concurrently, KG‑augmented large language models emerged to ground LLMs with structured, updatable facts, mitigating hallucinations and forming a neuro‑symbolic stack that integrates KGs deeply into deep‑learning pipelines. **This trend directly underpins Retrieval-Augmented Generation (RAG): KGs serve as structured, interpretable knowledge bases for retrieval, with Microsoft’s GraphRAG (2024) as a prominent example.**




## Directed edge-labelled graphs (the RDF view)

A **directed edge-labelled graph** is a tuple
$$G = (V,\ E,\ L)$$where
- $V$ is a finite set of **vertices** (entities, things);
- $L$ is a finite set of **edge labels** (relation names, predicates);
- $E \subseteq V \times L \times V$ is a finite set of **labelled directed edges**.

Each $e = (s, p, o) \in E$ is read "subject $s$ is related to object $o$ via predicate $p$."

```mermaid
graph LR
    G[("G = (V, E, L)")]:::root
    V["V — vertices<br/>I ∪ B ∪ L"]:::set
    E["E ⊆ V × L × V<br/>set of triples (s, p, o)"]:::set
    LL["L — edge labels<br/>⊆ I"]:::set
    G --> V
    G --> E
    G --> LL
    classDef root fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef set fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
```


## Property graphs (the Neo4j view)

### Definition

A **property graph** is a tuple

$$G = (V,\ E,\ \rho,\ \lambda,\ \sigma)$$

where
- $V$ is a finite set of **vertices**;
- $E$ is a finite set of **edges**, with $V \cap E = \emptyset$;
- $\rho : E \to V \times V$ is the **incidence function** assigning a (source, target) pair to each edge;
- $\lambda : V \cup E \to \mathrm{Lab}$ assigns a **label** to every vertex and edge;
- $\sigma : (V \cup E) \times \mathrm{Key} \to \mathrm{Val}$ is a partial function assigning **key-value properties** to vertices and edges.

The crucial differences from the RDF definition are:

1. **Edges have identity.** $E$ is a separate set, not a subset of $V \times L \times V$. Two edges between the same pair of vertices are distinct objects.
2. **Edges carry properties.** $\sigma$ ranges over $V \cup E$, so an edge `WORKS_AT` can have a `since: 2020` attribute *natively*.
3. **No global identifier alphabet.** Vertices and edges are identified by internal IDs, not IRIs. There is no built-in interoperability story.

```mermaid
graph LR
    G[("G = (V, E, ρ, λ, σ)")]:::root
    V["V — vertices"]:::set
    E["E — edges (with identity)<br/>V ∩ E = ∅"]:::set
    Rho["ρ : E → V × V<br/>(source, target)"]:::fn
    Lam["λ : V ∪ E → Lab<br/>labels"]:::fn
    Sig["σ : (V ∪ E) × Key → Val<br/>properties"]:::fn
    G --> V
    G --> E
    G --> Rho
    G --> Lam
    G --> Sig
    classDef root fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef set fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef fn  fill:#dcfce7,stroke:#15803d,color:#14532d
```



### Cypher Language



## Software Ecosystem & Graphical Representation

### Taxonomy of KG storage software

```mermaid
graph TD
    Root["KG storage<br/>software"]:::root

    Root --> RDF["<b>RDF triple stores</b><br/>SPARQL, RDF/OWL semantics"]:::rdf
    Root --> LPG["<b>Property-graph databases</b><br/>Cypher / Gremlin / GQL"]:::lpg
    Root --> Multi["<b>Multi-model</b><br/>support both"]:::mm

    RDF --> RDFopen["Open-source<br/>Apache Jena (Fuseki)<br/>RDF4J<br/>Blazegraph (legacy)<br/>Oxigraph<br/>Virtuoso OS"]:::tool
    RDF --> RDFcomm["Commercial<br/>GraphDB (Ontotext)<br/>Stardog<br/>AllegroGraph<br/>RDFox (Oxford Semantic)<br/>Virtuoso Enterprise"]:::tool

    LPG --> LPGopen["Open-source<br/>Neo4j Community<br/>JanusGraph<br/>Memgraph CE<br/>NebulaGraph<br/>Apache AGE (Postgres)"]:::tool
    LPG --> LPGcomm["Commercial / Cloud<br/>Neo4j Enterprise / AuraDB<br/>TigerGraph<br/>Memgraph Enterprise<br/>Amazon Neptune (LPG mode)<br/>TypeDB"]:::tool

    Multi --> Multitools["Amazon Neptune<br/>(RDF + LPG)<br/>ArangoDB (multi-model)<br/>Stardog (RDF + virtual graphs)<br/>Anzo (RDF + GraphQL)"]:::tool

    classDef root fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef rdf fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef lpg fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef mm  fill:#fce7f3,stroke:#be185d,color:#831843
    classDef tool fill:#f3f4f6,stroke:#9ca3af,color:#374151
```


### Toolchain

The store is only the centre of the stack. A real KG project needs **mapping**, **validation**, **ontology authoring**, **query interfaces**, and **embeddings/ML**. The full pipeline:

```mermaid
graph LR
    subgraph S["Sources"]
        S1[Tabular<br/>CSV / RDB]:::src
        S2[Documents<br/>PDF / HTML]:::src
        S3[Existing KGs<br/>Wikidata / schema.org]:::src
    end

    subgraph M["Mapping / Extraction"]
        M1[R2RML / RML<br/>Morph-KGC, RMLMapper]:::tool
        M2[NER + RE<br/>spaCy, REBEL,<br/>LLM-extractors]:::tool
        M3[SPARQL CONSTRUCT<br/>federated import]:::tool
    end

    subgraph O["Ontology"]
        O1[Protégé<br/>OWL / SHACL editor]:::tool
        O2[TopBraid Composer]:::tool
        O3[WebVOWL<br/>visual ontology browsing]:::tool
    end

    subgraph DB["Triple store / LPG"]
        DB1[GraphDB / Stardog /<br/>Jena Fuseki / Neo4j]:::store
    end

    subgraph V["Validation & Reasoning"]
        V1[pySHACL<br/>SHACL validator]:::tool
        V2[HermiT / Pellet / ELK<br/>OWL reasoners]:::tool
        V3[RDFox / Datalog<br/>rule materialisation]:::tool
    end

    subgraph Q["Query & API"]
        Q1[SPARQL endpoint]:::tool
        Q2[GraphQL gateway<br/>Hasura, HyperGraphQL]:::tool
        Q3[Cypher / Gremlin /<br/>GQL]:::tool
    end

    subgraph ML["Embeddings & ML"]
        ML1[PyKEEN<br/>AmpliGraph]:::tool
        ML2[DGL-KE / PyG]:::tool
        ML3[GraphRAG<br/>LightRAG, HippoRAG]:::tool
    end

    subgraph Vi["Visualization"]
        Vi1[Neo4j Bloom / Browser]:::tool
        Vi2[Gephi / Cytoscape]:::tool
        Vi3[yFiles / KeyLines /<br/>Linkurious]:::tool
        Vi4[SemSpect<br/>aggregated views]:::tool
    end

    S1 --> M1 --> DB1
    S2 --> M2 --> DB1
    S3 --> M3 --> DB1
    O1 --> DB1
    O2 --> DB1
    DB1 --> V1
    DB1 --> V2
    DB1 --> V3
    DB1 --> Q1
    DB1 --> Q2
    DB1 --> Q3
    DB1 --> ML1
    DB1 --> ML2
    ML1 --> ML3
    ML2 --> ML3
    DB1 --> Vi1
    DB1 --> Vi2
    DB1 --> Vi3
    DB1 --> Vi4

    classDef src fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef tool fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef store fill:#dcfce7,stroke:#15803d,color:#14532d
```
