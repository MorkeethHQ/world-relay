/** Campaign photography is decorative; it never stands in for submitted proof. */
export function FavourPageHero({title,description,image="/hero/desk.jpg",eyebrow="FAVOUR"}:{title:string;description?:string;image?:string;eyebrow?:string}) {
 return <section className="favour-page-hero">
  {/* eslint-disable-next-line @next/next/no-img-element */}
  <img src={image} alt="" aria-hidden="true" />
  <div className="favour-page-hero-shade" />
  <div className="favour-page-hero-copy"><p>{eyebrow}</p><p className="favour-page-hero-title">{title}</p>{description&&<p>{description}</p>}</div>
 </section>;
}
