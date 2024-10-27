const sanitizeHtml = require('sanitize-html');
const ObjectId = require('mongoose').Types.ObjectId;

const { BadRequestError, NotFoundError } = require('../errors');

const Proposal = require('../models/proposal');
const User = require('../models/user');

const helpers = require('../helpers');

/*const createProposal = async (req, res) => {
    try {
        const newProposal = new Proposal(req.body);
        await newProposal.save();
        res.status(201).json(newProposal);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
}*/

const getProposals = async (req, res, next) => {
    const searchQuery = helpers.normalizeString(req.query.search) || '';
    const filterCategories = req.query.categories || [];

    // Construir la consulta
    const query = {
        isDraft: false
    };

    // Si hay categorías en filterCategories, agregarlas a la consulta
    if (filterCategories.length > 0) {
        query.categories = { $in: filterCategories };
    }

    try {
        // Buscar todos los documentos, luego filtrar manualmente
        const rawProposals = await Proposal.find(query);

        // Normalizar los títulos y descripciones antes de hacer la comparación
        const filteredProposals = rawProposals.filter(p => {
            const normalizedTitle = helpers.normalizeString(p.title.toLowerCase());
            const normalizedDescription = helpers.normalizeString(p.description.toLowerCase());

            return (
                normalizedTitle.includes(searchQuery.toLowerCase()) ||
                normalizedDescription.includes(searchQuery.toLowerCase())
            );
        });

        // Obtener supporters usando async/await
        const proposals = await Promise.all(
            filteredProposals.map(async (p) => {
                return {
                    ...p.toObject(),
                    supporters: await p.getSupportersCount(),
                };
            })
        );

        const categories = await helpers.retrieveCategories();
        
        res.status(200).render('fragments/proposalCards', { layout: false, proposals, categories });
    } catch (error) {
        console.error("Error en proposals/getProposals:", error);
        return next(new Error("Ha ocurrido un error al realizar la búsqueda."));
    }
}

const getProposal = async (req, res, next) => {
    try {
        const proposal = await Proposal.findById(new ObjectId(req.params.id));
        proposal.supporters = await proposal.getSupportersCount();

        res.status(200).render('fragments/proposalDetailModal', { layout: false, proposal });
    } catch (error) {
        console.error("Error en proposal/getProposal:", error);
        return next(new Error("Ha ocurrido un error al obtener la propuesta."));
    }
}

/*const deleteProposal = async (req, res) => {
    try {
        await proposal.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: 'Proposal deleted' });
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
}*/

/* const getProposalByCategory = async (req, res) => {
    try {
        const proposals = await proposal.find({ categories: req.params.category });
        res.status(200).json(proposals);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
} */

/*const getProposalsCategories = async (req, res) => {
    try {
        const categories = await proposal.distinct('categories');
        res.status(200).json(categories);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
}*/

const addSupporter = async (req, res, next) => {
    try {
        const proposalId = req.params.id;
        const rawProposal = await Proposal
            .findById(new ObjectId(proposalId));
        if (!rawProposal) {
            console.error(`No se encuentra propuesta ${proposalId} para el usuario ${req.session.user.id}.`)
            req.toastr.error("Propuesta no encontrada.");
            return res.status(409).render('fragments/toastr', { layout: false, req: req });
        }

        const user = req.session.user

        if (user.supportedProposals.includes(rawProposal.id)) {
            console.warn(`El usuario ${req.session.user.id} ya apoya la propuesta ${proposalId}.`)
            req.toastr.warning("Ya estás apoyando esta propuesta.");
            return res.status(409).render('fragments/toastr', { layout: false, req: req });
        }

        user.supportedProposals.push(rawProposal.id);
        await user.save();

        const proposal = {
            ...rawProposal.toObject(),
            supporters: await rawProposal.getSupportersCount()
        }

        const categories = await helpers.retrieveCategories();
        
        res.locals.user = req.session.user;
        res.status(200).render('fragments/proposalCard', { layout: false, proposal, categories });
    } catch (error) {
        console.error('Error en proposal/addSupporter: ' + error.message);
        return next(new Error("Ha ocurrido un error al apoyar la propuesta."));
    }
}

const removeSupporter = async (req, res, next) => {
    try {
        const proposalId = req.params.id;
        const rawProposal = await Proposal
            .findById(new ObjectId(proposalId));
        if (!rawProposal) {
            console.error(`No se encuentra propuesta ${proposalId} para el usuario ${req.session.user.id}.`)
            req.toastr.error("Propuesta no encontrada.");
            return res.status(404).render('fragments/toastr', { layout: false, req: req });
        }

        const user = req.session.user

        if (!user.supportedProposals.includes(rawProposal.id)) {
            console.warn(`El usuario ${req.session.user.id} no apoya la propuesta ${proposalId}.`)
            req.toastr.warning("No estás apoyando esta propuesta.");
            return res.status(409).render('fragments/toastr', { layout: false, req: req });
        }

        user.supportedProposals.splice(user.supportedProposals.indexOf(new ObjectId(rawProposal.id)), 1);
        await rawProposal.save();
        await user.save();

        const proposal = {
            ...rawProposal.toObject(),
            supporters: await rawProposal.getSupportersCount()
        }

        const categories = await helpers.retrieveCategories();
        
        res.locals.user = req.session.user;
        res.status(200).render('fragments/proposalCard', { layout: false, proposal, categories });
    } catch (error) {
        console.error('Error en proposal/removeSuporter: ' + error.message);
        return next(new Error("Ha ocurrido un error al retirar el apoyo a la propuesta."));
    }
}

const getDraftForm = async (req, res, next) => {
    try {
        const categories = await helpers.retrieveCategories();
        
        res.status(200).render('fragments/proposalDraftModal', { layout: false, categories });

    } catch (error) {
        console.error('Error en proposal/getDraftForm: ' + error.message);
        return next(new Error("Ha ocurrido un error al obtener el formulario."));
    }

}

const sendProposalAsDraft = async (req, res) => {
    try {
        if (!req.body.title || req.body.title.trim() === "") {
            console.error('Error en sendProposalAsDraft:');
            console.error(`El usuario ${req.session.user.id} ha intentado enviar una propuesta sin título.`)
            return next(new BadRequestError("La propuesta debe contener un título."));
        }

        if (!req.body.description || req.body.description.trim() === "") {
            console.error('Error en sendProposalAsDraft:');
            console.error(`El usuario ${req.session.user.id} ha intentado enviar una propuesta sin descripción.`)
            return next(new BadRequestError("La propuesta debe contener una descripción."));
        }

        const sanitizedDescription = sanitizeHtml(req.body.description, {
            allowedTags: ['b', 'i', 'u', 'ul', 'ol', 'li'],
            allowedAttributes: {}
        });

        const categories = await helpers.retrieveCategories();
        
        const fileteredCategories = req.body.categories.filter(category => categories.hasOwnProperty(category));

        if (fileteredCategories.length < 1) {
            console.error('Error en sendProposalAsDraft:');
            console.error(`El usuario ${req.session.user.id} ha intentado enviar una propuesta sin categorías o con categorías inválidas: ${req.body.categories}.`)
            return next(new BadRequestError("La propuesta debe contener al menos una categoría de las disponibles."));
        }

        const proposalData = {
            title: sanitizeHtml(req.body.title, { allowedTags: [], allowedAttributes: {} }),
            description: sanitizedDescription,
            categories: fileteredCategories,
            isDraft: true,
            usersDrafting: req.session.user.id,
        }

        const newProposal = new Proposal(proposalData);
        newProposal.save();
    } catch (error) {
        console.error('Error en proposal/sendProposalAsDraft: ' + error.message);
        return next(new Error("Ha ocurrido un error al enviar la propuesta."));
    }
}

/*const getDraftProposals = async (req, res) => {
    try {
        const proposals = await proposal.find({ isDraft: true });
        res.status(200).json(proposals);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}*/

/*const deleteDraftProposal = async (req, res) => {
    try {
        await proposal.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: 'Draft proposal deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}*/

/*const approveDraftProposal = async (req, res) => {
    try {
        let userProposing = new Set();
        let deleteProposals = req.body.deleteProposals;
        for (let proposalId of deleteProposals) {
            const proposal = await proposal.findById(proposalId);
            userProposing.add(proposal.usersDrafting);
            await proposal.findByIdAndDelete(proposalId);
        }
        const newProposal = new proposal(req.body);
        newProposal.isDraft = false;
        newProposal.usersDrafting = userProposing;
        await newProposal.save();
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}*/

module.exports = {
    //createProposal,
    getProposals,
    getProposal,
    //deleteProposal,
    //getProposalByCategory,
    //getProposalsCategories,
    addSupporter,
    removeSupporter,
    getDraftForm,
    sendProposalAsDraft,
    //getDraftProposals,
    //deleteDraftProposal,
    //approveDraftProposal
}